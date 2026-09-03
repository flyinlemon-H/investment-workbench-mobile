import copy
import json
import tempfile
import unittest
from pathlib import Path
from urllib.error import HTTPError

from scripts import fetch_cloud_universe as cloud
from scripts import update_market_universe as universe
from tests import test_mobile_universe_pc as fixtures

fake_update = fixtures.fake_update
signed_manifest = fixtures.signed_manifest

OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'


def credential():
    return dict(schemaVersion=1, projectRef=cloud.PRODUCTION_REF, userId=OWNER,
                token='b' * 64, expiresAt='2099-01-01T00:00:00Z')


def payload(symbols=('600487.SS',)):
    return dict(schemaVersion=1, userId=OWNER, credentialExpiresAt='2099-01-01T00:00:00Z',
                symbols=[dict(symbol=s, displayName='fixture') for s in symbols])


class CloudUniverseTest(unittest.TestCase):
    def test_shared_symbol_vectors(self):
        vectors = json.loads((Path(__file__).parent / 'fixtures/market-symbol-vectors.json').read_text(encoding='utf-8'))
        for row in vectors:
            self.assertEqual(universe.canonical_symbol(row['input']), row['canonical'])

    def test_strict_payload_and_owner(self):
        self.assertEqual(cloud.validate_payload(payload(), OWNER)[0]['symbol'], '600487.SS')
        invalid = [dict(payload(), schemaVersion=2), dict(payload(), userId='other'),
                   dict(payload(), credentialExpiresAt='invalid'), dict(payload(), holdings=[]),
                   payload(('600000.SH',)), payload(('600487.SS', '600487.SS')),
                   dict(payload(), symbols=[dict(symbol='600487.SS', displayName='x', shares=10)])]
        for value in invalid:
            with self.assertRaises(cloud.CloudUniverseError):
                cloud.validate_payload(value, OWNER)

    def test_dpapi_outside_repository(self):
        with tempfile.TemporaryDirectory() as folder:
            file = Path(folder) / 'reader.bin'
            cloud.save_credential(credential(), file)
            self.assertNotIn(credential()['token'].encode(), file.read_bytes())
            self.assertEqual(cloud.load_credential(file), credential())
        with self.assertRaises(cloud.CloudUniverseError):
            cloud.save_credential(credential(), Path(__file__).parent / 'forbidden.bin')

    def test_failures_redact_and_retain_lkg(self):
        def fail(error):
            def request(_):
                raise error
            return cloud.fetch_cloud_universe(credential_loader=credential, request=request)
        failures = [fail(TimeoutError('PRIVATE_TOKEN')), fail(HTTPError('secret', 401, 'PRIVATE_TOKEN', {}, None)),
                    cloud.fetch_cloud_universe(credential_loader=credential, request=lambda _: payload(('bad',)))]
        self.assertEqual([r['status'] for r in failures], ['offline', 'auth_required', 'error'])
        for failure in failures:
            self.assertNotIn('PRIVATE_TOKEN', json.dumps(failure))
            summary, before, after, _ = self.run_fixture(failure)
            self.assertEqual(summary['success'], 2)
            self.assertEqual([r['symbol'] for r in after['symbols']], ['000858.SZ'])
            self.assertEqual(before['symbols'][0]['displayName'], after['symbols'][0]['displayName'])

    def run_fixture(self, result, manual=False, updater=fake_update):
        helper = fixtures.MobileUniversePcTest()
        temp, formal, registry, inbox, bridge = helper.fixture()
        self.addCleanup(temp.cleanup)
        before = dict(schemaVersion=1, updatedAt='', lastManifest=None, symbols=[
            dict(symbol='000858.SZ', active=True, displayName='existing', addedAt='', marketFacts={})])
        registry.write_text(json.dumps(before), encoding='utf-8')
        if manual:
            (inbox / 'fixture.json').write_text(json.dumps(signed_manifest([dict(symbol='600487.SS', active=True)])), encoding='utf-8')
        summary = universe.run_update(formal_path=formal, registry_path=registry, inbox_path=inbox,
                                     bridge_path=bridge, update_function=updater, cloud_fetch=lambda: result)
        return summary, before, json.loads(registry.read_text(encoding='utf-8')), formal

    def test_union_duplicate_formal_and_manual_and_no_removal(self):
        result = cloud.fetch_cloud_universe(credential_loader=credential, request=lambda _: payload(('600487.SS','600000.SS')))
        seen = []
        def update(state, **kwargs):
            seen.extend(copy.deepcopy(state['stocks']))
            return fake_update(state, **kwargs)
        summary, _, after, formal = self.run_fixture(result, manual=True, updater=update)
        self.assertEqual(summary['symbols'], 3)
        self.assertEqual([s['symbol'] for s in after['symbols']], ['000858.SZ','600000.SS','600487.SS'])
        self.assertEqual(sum(s['code']=='600000.SS' for s in seen), 1)
        self.assertTrue(next(s for s in seen if s['code']=='600487.SS')['marketOnly'])
        held = json.loads(formal.read_text(encoding='utf-8'))['stocks'][0]
        self.assertEqual(held['shares'],1)
        self.assertEqual(held['plans'],[dict(price=7)])

    def test_accepted_membership_survives_market_provider_exception(self):
        helper = fixtures.MobileUniversePcTest()
        temp, formal, registry, inbox, bridge = helper.fixture()
        self.addCleanup(temp.cleanup)
        result = cloud.fetch_cloud_universe(credential_loader=credential, request=lambda _: payload())
        def fail(*args, **kwargs):
            raise RuntimeError('provider offline')
        with self.assertRaises(RuntimeError):
            universe.run_update(formal_path=formal, registry_path=registry, inbox_path=inbox,
                                bridge_path=bridge, update_function=fail, cloud_fetch=lambda:result)
        self.assertEqual(json.loads(registry.read_text(encoding='utf-8'))['symbols'][0]['symbol'],'600487.SS')


if __name__ == '__main__':
    unittest.main()
