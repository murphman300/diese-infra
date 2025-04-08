import createDatabase, { DatabaseResources } from "./main";

export type { DatabaseResources };

export function createStagingDatabase() {
    return createDatabase("staging");
}

export function createProductionDatabase() {
    return createDatabase("production");
}

const createDatabases = (env: string) => {
    if (env === "staging") {
        return createStagingDatabase();
    } else if (env === "production") {
        return createProductionDatabase();
    } else {
        throw new Error(`Invalid environment: ${env}`);
    }
}

export default createDatabases;
