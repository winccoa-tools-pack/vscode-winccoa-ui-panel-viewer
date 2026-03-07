import * as assert from 'assert';
import * as path from 'path';
import { parsePanelXml } from '../../panelParser';

// Fixture paths are relative to the compiled output directory (dist/test/unit)
// At runtime the test runs from dist/, so we need to reference src/test/fixtures
const fixturesDir = path.resolve(__dirname, '..', '..', '..', 'src', 'test', 'fixtures');

suite('panelParser Unit Tests', () => {
    suite('parsePanelXml', () => {
        test('parses simple panel XML and extracts panel properties', () => {
            const xmlPath = path.join(fixturesDir, 'simple-panel.xml');
            const pnlPath = '/test/simple-panel.pnl';

            const model = parsePanelXml(xmlPath, pnlPath);

            assert.strictEqual(model.filePath, pnlPath);
            assert.strictEqual(model.name, 'simple-panel');
            assert.ok(model.properties.length > 0, 'Should have panel properties');

            const titleProp = model.properties.find((p) => p.name === 'windowTitle');
            assert.ok(titleProp, 'Should have windowTitle property');
            assert.strictEqual(titleProp?.value, 'Test Panel');
        });

        test('parses shapes from XML', () => {
            const xmlPath = path.join(fixturesDir, 'simple-panel.xml');
            const pnlPath = '/test/simple-panel.pnl';

            const model = parsePanelXml(xmlPath, pnlPath);

            assert.ok(model.shapes.length >= 2, 'Should have at least 2 shapes');

            const button = model.shapes.find((s) => s.name === 'myButton');
            assert.ok(button, 'Should have myButton shape');
            assert.strictEqual(button?.shapeType, 'PUSH_BUTTON');

            const label = model.shapes.find((s) => s.name === 'myLabel');
            assert.ok(label, 'Should have myLabel shape');
            assert.strictEqual(label?.shapeType, 'PRIMITIVE_TEXT');
        });

        test('parses shape properties', () => {
            const xmlPath = path.join(fixturesDir, 'simple-panel.xml');
            const pnlPath = '/test/simple-panel.pnl';

            const model = parsePanelXml(xmlPath, pnlPath);

            const button = model.shapes.find((s) => s.name === 'myButton');
            assert.ok(button, 'Should have myButton shape');

            const textProp = button?.properties.find((p) => p.name === 'text');
            assert.ok(textProp, 'Button should have text property');
            assert.strictEqual(textProp?.value, 'Click Me');
        });

        test('parses scripts from shapes', () => {
            const xmlPath = path.join(fixturesDir, 'simple-panel.xml');
            const pnlPath = '/test/simple-panel.pnl';

            const model = parsePanelXml(xmlPath, pnlPath);

            const button = model.shapes.find((s) => s.name === 'myButton');
            assert.ok(button, 'Should have myButton shape');
            assert.ok(button?.scripts.length > 0, 'Button should have scripts');

            const clickedScript = button?.scripts.find((s) => s.event === 'Clicked');
            assert.ok(clickedScript, 'Button should have Clicked script');
            assert.ok(clickedScript?.code.includes('DebugN'), 'Script should contain DebugN');
        });

        test('returns empty model for empty panel XML', () => {
            const xmlPath = path.join(fixturesDir, 'empty-panel.xml');
            const pnlPath = '/test/empty-panel.pnl';

            const model = parsePanelXml(xmlPath, pnlPath);

            assert.strictEqual(model.filePath, pnlPath);
            assert.strictEqual(model.shapes.length, 0);
            assert.strictEqual(model.errors.length, 0);
        });

        test('returns model with error when XML file does not exist', () => {
            const xmlPath = path.join(fixturesDir, 'non-existent.xml');
            const pnlPath = '/test/non-existent.pnl';

            const model = parsePanelXml(xmlPath, pnlPath);

            assert.strictEqual(model.filePath, pnlPath);
            assert.ok(model.errors.length > 0, 'Should have parse error');
            assert.ok(model.errors[0].includes('Parse error'), 'Error should mention parse error');
        });
    });
});
