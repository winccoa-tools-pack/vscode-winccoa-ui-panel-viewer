import * as assert from 'assert';
import * as path from 'path';
import { isEncryptedPanel } from '../../converter';

// Fixture paths are relative to the compiled output directory (dist/test/unit)
// At runtime the test runs from dist/, so we need to reference src/test/fixtures
const fixturesDir = path.resolve(__dirname, '..', '..', '..', 'src', 'test', 'fixtures');

suite('converter Unit Tests', () => {
    suite('isEncryptedPanel', () => {
        test('returns true for encrypted panel file', async () => {
            const filePath = path.join(fixturesDir, 'encrypted-panel.pnl');
            const result = await isEncryptedPanel(filePath);
            assert.strictEqual(result, true);
        });

        test('returns false for non-encrypted panel file', async () => {
            const filePath = path.join(fixturesDir, 'not-encrypted-panel.pnl');
            const result = await isEncryptedPanel(filePath);
            assert.strictEqual(result, false);
        });

        test('returns false for non-existent file', async () => {
            const filePath = path.join(fixturesDir, 'does-not-exist.pnl');
            const result = await isEncryptedPanel(filePath);
            assert.strictEqual(result, false);
        });

        test('returns false for XML file (not a panel)', async () => {
            const filePath = path.join(fixturesDir, 'simple-panel.xml');
            const result = await isEncryptedPanel(filePath);
            assert.strictEqual(result, false);
        });
    });
});
