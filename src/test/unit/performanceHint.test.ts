import * as assert from 'assert';

import { showPerformanceHintOnce } from '../../performanceHint';

suite('performanceHint Unit Tests', () => {
    function createMemento(initial?: Record<string, unknown>) {
        const store = new Map<string, unknown>(Object.entries(initial ?? {}));
        return {
            get<T>(key: string, defaultValue?: T): T {
                if (store.has(key)) {
                    return store.get(key) as T;
                }
                return defaultValue as T;
            },
            async update(key: string, value: unknown): Promise<void> {
                store.set(key, value);
            },
            _store: store,
        };
    }

    test('shows hint once when enabled and not yet shown', async () => {
        const configuration = {
            get<T>(key: string, defaultValue?: T): T {
                if (key === 'showPerformanceHint') {
                    return true as T;
                }
                return defaultValue as T;
            },
        };

        const globalState = createMemento();
        const messages: string[] = [];

        const didShow = await showPerformanceHintOnce({
            configuration,
            globalState,
            showInformationMessage: (message: string) => {
                messages.push(message);
            },
        });

        assert.strictEqual(didShow, true);
        assert.strictEqual(messages.length, 1);
        assert.ok(messages[0].includes('XML'));
        assert.strictEqual(
            globalState.get<boolean>('performanceHintShown', false),
            true,
        );

        const didShowAgain = await showPerformanceHintOnce({
            configuration,
            globalState,
            showInformationMessage: (message: string) => {
                messages.push(message);
            },
        });

        assert.strictEqual(didShowAgain, false);
        assert.strictEqual(messages.length, 1);
    });

    test('does not show hint when disabled by setting', async () => {
        const configuration = {
            get<T>(key: string, defaultValue?: T): T {
                if (key === 'showPerformanceHint') {
                    return false as T;
                }
                return defaultValue as T;
            },
        };

        const globalState = createMemento();
        let called = false;

        const didShow = await showPerformanceHintOnce({
            configuration,
            globalState,
            showInformationMessage: () => {
                called = true;
            },
        });

        assert.strictEqual(didShow, false);
        assert.strictEqual(called, false);
        assert.strictEqual(
            globalState.get<boolean>('performanceHintShown', false),
            false,
        );
    });

    test('does not show hint when already shown', async () => {
        const configuration = {
            get<T>(key: string, defaultValue?: T): T {
                if (key === 'showPerformanceHint') {
                    return true as T;
                }
                return defaultValue as T;
            },
        };

        const globalState = createMemento({ performanceHintShown: true });
        let called = false;

        const didShow = await showPerformanceHintOnce({
            configuration,
            globalState,
            showInformationMessage: () => {
                called = true;
            },
        });

        assert.strictEqual(didShow, false);
        assert.strictEqual(called, false);
    });
});
