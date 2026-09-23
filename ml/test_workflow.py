"""Synthetic workflow checks only; these are not model efficacy measurements."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent


class WorkflowTest(unittest.TestCase):
    def test_freeze_train_export_evaluate(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            items = []
            for i in range(80):
                relevant = i % 2 == 0
                title = f'Kenya flooding mass evacuation district {i}' if relevant else f'France football cup goals round {i}'
                items.append({'article': {'id': f'a{i}', 'storyId': f's{i}', 'title': title, 'snippet': '',
                                          'url': f'https://example.org/{i}', 'language': 'English', 'geoOnly': False,
                                          'observedAt': f'2026-09-{1+i//4:02d}T{i%4:02d}:00:00Z',
                                          'classification': {'relevance': 'relevant' if relevant else 'irrelevant'}},
                              'label': {'relevance': 'relevant' if relevant else 'irrelevant', 'storyId': f's{i}',
                                        'slice': 'event' if relevant else 'routine-sports', 'category': 'Disaster' if relevant else 'Unclassified'},
                              'revision': 1, 'reviewedAt': '2026-09-23T00:00:00Z'})
            labels = directory/'labels.json'
            labels.write_text(json.dumps({'items': items}))
            def cli(*args, success=True):
                result = subprocess.run([sys.executable, str(ROOT/'ml/train.py'), *map(str,args)], capture_output=True, text=True)
                self.assertEqual(result.returncode == 0, success, result.stderr)
                return result
            dataset, model, report = directory/'dataset', directory/'model.json', directory/'report.json'
            cli('prepare', '--labels', labels, '--output', dataset)
            cli('train', '--dataset', dataset, '--output', model)
            parity = subprocess.run(['node', str(ROOT/'scripts/model-parity.js'), str(model)], capture_output=True, text=True)
            self.assertEqual(parity.returncode, 0, parity.stderr)
            cli('evaluate', '--dataset', dataset, '--model', model, '--output', report)
            result = json.loads(report.read_text())
            self.assertFalse(result['offlinePassed'])
            self.assertFalse(result['sufficientSample'])
            cli('evaluate', '--dataset', dataset, '--model', model, '--output', directory/'again.json', success=False)
            cli('prepare', '--labels', labels, '--output', dataset, success=False)
            (dataset/'train.json').write_text('[]')
            cli('train', '--dataset', dataset, '--output', directory/'other-model.json', success=False)


if __name__ == '__main__':
    unittest.main()
