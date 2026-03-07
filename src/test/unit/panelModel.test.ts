import * as assert from 'assert';
import { createEmptyPanelModel, createEncryptedPanelModel } from '../../panelModel';

suite('panelModel Unit Tests', () => {
    suite('createEmptyPanelModel', () => {
        test('returns a PanelModel with the given filePath', () => {
            const filePath = '/some/path/to/myPanel.pnl';
            const model = createEmptyPanelModel(filePath);
            assert.strictEqual(model.filePath, filePath);
        });

        test('extracts name from filename (Unix path)', () => {
            const model = createEmptyPanelModel('/panels/subfolder/TestPanel.pnl');
            assert.strictEqual(model.name, 'TestPanel');
        });

        test('extracts name from filename (Windows path)', () => {
            const model = createEmptyPanelModel('C:\\panels\\subfolder\\MyPanel.pnl');
            assert.strictEqual(model.name, 'MyPanel');
        });

        test('extracts name with case-insensitive .pnl extension', () => {
            const model = createEmptyPanelModel('/panels/Test.PNL');
            assert.strictEqual(model.name, 'Test');
        });

        test('handles filename without .pnl extension', () => {
            const model = createEmptyPanelModel('/panels/NoExtension');
            assert.strictEqual(model.name, 'NoExtension');
        });

        test('returns empty arrays for shapes, properties, scripts, references, errors', () => {
            const model = createEmptyPanelModel('/test.pnl');
            assert.deepStrictEqual(model.shapes, []);
            assert.deepStrictEqual(model.properties, []);
            assert.deepStrictEqual(model.scripts, []);
            assert.deepStrictEqual(model.references, []);
            assert.deepStrictEqual(model.errors, []);
        });

        test('returns encrypted = false', () => {
            const model = createEmptyPanelModel('/test.pnl');
            assert.strictEqual(model.encrypted, false);
        });
    });

    suite('createEncryptedPanelModel', () => {
        test('returns a PanelModel with encrypted = true', () => {
            const model = createEncryptedPanelModel('/encrypted.pnl');
            assert.strictEqual(model.encrypted, true);
        });

        test('includes an error message about encryption', () => {
            const model = createEncryptedPanelModel('/encrypted.pnl');
            assert.strictEqual(model.errors.length, 1);
            assert.ok(model.errors[0].toLowerCase().includes('encrypted'));
        });

        test('extracts name from filename', () => {
            const model = createEncryptedPanelModel('/panels/SecurePanel.pnl');
            assert.strictEqual(model.name, 'SecurePanel');
        });

        test('returns empty arrays for shapes, properties, scripts, references', () => {
            const model = createEncryptedPanelModel('/test.pnl');
            assert.deepStrictEqual(model.shapes, []);
            assert.deepStrictEqual(model.properties, []);
            assert.deepStrictEqual(model.scripts, []);
            assert.deepStrictEqual(model.references, []);
        });
    });
});
