#!/usr/bin/env python3
"""Offline reviewed-data workflow. No network calls; never trains on test examples."""
import argparse
import hashlib
import json
import math
import re
from pathlib import Path


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write(path, value):
    Path(path).write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n')


def features(text):
    words = re.findall(r'[a-z0-9]+', text.lower())
    result = ['w:' + word for word in words]
    result += ['b:' + a + ' ' + b for a, b in zip(words, words[1:])]
    normalized = ' '.join(words)
    for n in (3, 4, 5):
        result += ['c:' + normalized[i:i+n] for i in range(max(0, len(normalized)-n+1))]
    return result


def text(row):
    return row['article']['title'] + '. ' + row['article'].get('snippet', '')


def prepare(args):
    output = Path(args.output)
    if output.exists():
        raise ValueError('Output already exists; create a new immutable dataset directory')
    source = json.loads(Path(args.labels).read_text())
    rows = source['items']
    # Union manual story groups AND ingestion syndication groups, preventing accidental
    # manual relabeling from splitting known duplicates across train/test.
    parents = {}

    def root(key):
        parents.setdefault(key, key)
        if parents[key] != key:
            parents[key] = root(parents[key])
        return parents[key]

    for row in rows:
        a, label = row['article'], row['label']
        keys = ['manual:' + label['storyId'], 'auto:' + a['storyId'], 'id:' + a['id']]
        for key in keys[1:]:
            parents[root(key)] = root(keys[0])
    groups = {}
    uncertain = 0
    for row in rows:
        a, label = row['article'], row['label']
        if label['relevance'] == 'uncertain' or a.get('geoOnly') or a.get('language', '').lower() not in ('en', 'english'):
            uncertain += 1
            continue
        if not row.get('reviewedAt') or not row.get('revision'):
            raise ValueError('Every training row needs a reviewed revision and timestamp')
        groups.setdefault(root('id:' + a['id']), []).append(row)
    ordered = sorted(groups.values(), key=lambda g: max(r['article']['observedAt'] for r in g))
    if len(ordered) < 10:
        raise ValueError('At least 10 reviewed independent story groups required to make three splits')
    n = len(ordered)
    splits = {'train': ordered[:int(n*.6)], 'validation': ordered[int(n*.6):int(n*.8)], 'test': ordered[int(n*.8):]}
    output.mkdir(parents=True)
    manifest = {'version': 1, 'sourceHash': digest(args.labels), 'excludedUncertainOrUnsupported': uncertain, 'files': {}}
    for name, group_list in splits.items():
        data = [r for group in group_list for r in group]
        path = output / (name + '.json')
        write(path, data)
        manifest['files'][name] = {'sha256': digest(path), 'rows': len(data), 'groups': len(group_list)}
    write(output / 'manifest.json', manifest)
    print(json.dumps(manifest, indent=2))


def read_split(directory, name):
    manifest = json.loads((directory / 'manifest.json').read_text())
    path = directory / (name + '.json')
    if digest(path) != manifest['files'][name]['sha256']:
        raise ValueError('Dataset changed after freeze: ' + name)
    return json.loads(path.read_text())


def metrics(labels, accepted):
    tp = sum(int(y == 1 and p) for y, p in zip(labels, accepted))
    fp = sum(int(y == 0 and p) for y, p in zip(labels, accepted))
    positives = int(sum(labels))
    precision = tp / (tp + fp) if tp + fp else 0
    recall = tp / positives if positives else 0
    # Wilson interval, with denominators included so small samples remain visible.
    def interval(k, n):
        if not n:
            return [0, 1]
        z = 1.96
        p = k/n
        center = (p + z*z/(2*n))/(1+z*z/n)
        width = z*math.sqrt(p*(1-p)/n+z*z/(4*n*n))/(1+z*z/n)
        return [center-width, center+width]
    return {'n': len(labels), 'positives': positives, 'accepted': tp+fp, 'tp': tp, 'fp': fp,
            'precision': precision, 'recall': recall, 'precision95CI': interval(tp, tp+fp), 'recall95CI': interval(tp, positives)}


def train(args):
    import numpy as np
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.linear_model import LogisticRegression
    directory = Path(args.dataset)
    training, validation = read_split(directory, 'train'), read_split(directory, 'validation')
    y = np.array([int(r['label']['relevance'] == 'relevant') for r in training])
    if len(set(y)) != 2:
        raise ValueError('Training requires both relevant and irrelevant examples')
    vectorizer = TfidfVectorizer(analyzer=features, sublinear_tf=True, norm='l2', min_df=2, max_features=40000)
    x = vectorizer.fit_transform([text(r) for r in training])
    vx = vectorizer.transform([text(r) for r in validation])
    vy = [int(r['label']['relevance'] == 'relevant') for r in validation]
    baseline = [r['article']['classification']['relevance'] == 'relevant' for r in validation]
    candidates = []
    for c in (.1, 1.0, 10.0):
        model = LogisticRegression(C=c, max_iter=2000, random_state=17).fit(x, y)
        scores = model.predict_proba(vx)[:, 1]
        for threshold in (.5, .6, .7, .8, .85, .9, .95, .98):
            accepted = [base and score >= threshold for base, score in zip(baseline, scores)]
            report = metrics(vy, accepted)
            candidates.append((report['precision'] >= .95 and report['recall'] >= .8,
                               report['recall'] if report['precision'] >= .95 else 0,
                               report['precision'], -c, threshold, model, report))
    winner = max(candidates, key=lambda candidate: candidate[:5])
    model, report = winner[5], winner[6]
    artifact = {'version': 'tfidf-logreg-v1', 'pipelineVersion': 'evidence-v1',
                'vocabulary': vectorizer.get_feature_names_out().tolist(), 'idf': vectorizer.idf_.tolist(),
                'coefficients': model.coef_[0].tolist(), 'intercept': float(model.intercept_[0]),
                'acceptThreshold': winner[4], 'rejectThreshold': .2,
                'datasetManifestHash': digest(directory/'manifest.json'),
                'validation': report, 'C': -winner[3], 'trainingRows': len(training)}
    output = Path(args.output)
    if output.exists():
        raise ValueError('Model output already exists; use a new version path')
    output.parent.mkdir(parents=True, exist_ok=True)
    write(output, artifact)
    # Reference fixtures test exported feature normalization and inference in Node.
    parity = [{'text': text(r), 'probability': float(model.predict_proba(vectorizer.transform([text(r)]))[0, 1])} for r in validation[:25]]
    for sentence in ('', 'Flooding in Kenya. evacuation underway', 'FRANCE football battle', 'Café — Nairobi’s protests 123'):
        parity.append({'text': sentence, 'probability': float(model.predict_proba(vectorizer.transform([sentence]))[0, 1])})
    write(str(output)+'.parity.json', parity)
    print(json.dumps({'modelHash': digest(output), 'validation': report, 'productionReady': False}, indent=2))


def infer(artifact, sentence):
    from collections import Counter
    index = {v: i for i, v in enumerate(artifact['vocabulary'])}
    counts = Counter(index[f] for f in features(sentence) if f in index)
    weights = {i: (1+math.log(count))*artifact['idf'][i] for i, count in counts.items()}
    norm = math.sqrt(sum(v*v for v in weights.values()))
    logit = artifact['intercept'] + (sum(v/norm*artifact['coefficients'][i] for i, v in weights.items()) if norm else 0)
    return 1/(1+math.exp(-max(-700, min(700, logit)))) if norm else 0


def evaluate(args):
    directory, model_path, output = Path(args.dataset), Path(args.model), Path(args.output)
    if output.exists() or Path(str(model_path)+'.evaluated').exists():
        raise ValueError('Test has already been evaluated for this artifact; do not retune on test results')
    artifact = json.loads(model_path.read_text())
    if artifact['datasetManifestHash'] != digest(directory/'manifest.json'):
        raise ValueError('Model and frozen dataset do not match')
    rows = read_split(directory, 'test')
    labels = [int(r['label']['relevance'] == 'relevant') for r in rows]
    baseline = [r['article']['classification']['relevance'] == 'relevant' for r in rows]
    accepted = [b and infer(artifact, text(r)) >= artifact['acceptThreshold'] for b, r in zip(baseline, rows)]
    report, base = metrics(labels, accepted), metrics(labels, baseline)
    slices = {}
    for key in sorted({r['label']['slice'] for r in rows} | {r['label']['category'] for r in rows}):
        indices = [i for i,r in enumerate(rows) if key in (r['label']['slice'],r['label']['category'])]
        slices[key] = metrics([labels[i] for i in indices], [accepted[i] for i in indices])
    enough = len(rows) >= 200 and report['positives'] >= 50 and (len(rows)-report['positives']) >= 50 and slices.get('routine-sports',{}).get('n',0) >= 30
    passed = enough and report['precision'] >= .95 and report['recall'] >= .8 and report['fp'] < base['fp'] and report['recall'] >= base['recall']-.05 and slices['routine-sports']['fp'] == 0
    result = {'modelHash': digest(model_path), 'datasetManifestHash': digest(directory/'manifest.json'), 'pipelineVersion': 'evidence-v1',
              'offlinePassed': passed, 'sufficientSample': enough, 'candidate': report, 'baseline': base, 'slices': slices,
              'errors': [{'id':r['article']['id'],'url':r['article']['url'],'label':labels[i],'accepted':accepted[i]} for i,r in enumerate(rows) if bool(labels[i]) != accepted[i]]}
    write(output, result)
    Path(str(model_path)+'.evaluated').write_text(digest(output)+'\n')
    print(json.dumps(result, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    p = sub.add_parser('prepare'); p.add_argument('--labels', required=True); p.add_argument('--output', required=True); p.set_defaults(fn=prepare)
    p = sub.add_parser('train'); p.add_argument('--dataset', required=True); p.add_argument('--output', required=True); p.set_defaults(fn=train)
    p = sub.add_parser('evaluate'); p.add_argument('--dataset', required=True); p.add_argument('--model', required=True); p.add_argument('--output', required=True); p.set_defaults(fn=evaluate)
    args = parser.parse_args()
    try:
        args.fn(args)
    except (ValueError, KeyError) as error:
        parser.exit(1, str(error)+'\n')


if __name__ == '__main__':
    main()
