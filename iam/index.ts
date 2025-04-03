import { createGitHubRunnerIAMResources } from "./github-runner";

export const createIAMResources = (env: string) => {
    return {
        githubRunner: createGitHubRunnerIAMResources(env),
    }
};

export default createIAMResources;
