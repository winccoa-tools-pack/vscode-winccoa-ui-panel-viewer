import { EXTENSION_CONFIG_SECTION } from './const';

const PERFORMANCE_HINT_CONFIG_KEY = 'showPerformanceHint';
const PERFORMANCE_HINT_SHOWN_STATE_KEY = 'performanceHintShown';

type ConfigurationLike = {
    get<T>(section: string, defaultValue?: T): T;
};

type MementoLike = {
    get<T>(key: string, defaultValue?: T): T;
    update(key: string, value: unknown): Thenable<void>;
};

type ShowInformationMessageLike = (message: string) => Thenable<unknown> | unknown;

export async function showPerformanceHintOnce(params: {
    configuration: ConfigurationLike;
    globalState: MementoLike;
    showInformationMessage: ShowInformationMessageLike;
}): Promise<boolean> {
    const enabled = params.configuration.get<boolean>(PERFORMANCE_HINT_CONFIG_KEY, true);
    if (!enabled) {
        return false;
    }

    const alreadyShown = params.globalState.get<boolean>(PERFORMANCE_HINT_SHOWN_STATE_KEY, false);
    if (alreadyShown) {
        return false;
    }

    // Do not await user interaction here (important for headless/test activation).
    void Promise.resolve(
        params.showInformationMessage('Performance tip: XML-based workflow is typically faster.'),
    );
    await params.globalState.update(PERFORMANCE_HINT_SHOWN_STATE_KEY, true);
    return true;
}

export function getPerformanceHintConfiguration(configuration: {
    getConfiguration(section: string): ConfigurationLike;
}): ConfigurationLike {
    return configuration.getConfiguration(EXTENSION_CONFIG_SECTION);
}
