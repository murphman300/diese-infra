import * as aws from "@pulumi/aws";

export function createContainerRegistry(env: string) {
    // Create ECR repository
    const repositoryName = `${env}-diese-web-app-repository`;
    const repository = new aws.ecr.Repository(repositoryName, {
        name: repositoryName,
        imageScanningConfiguration: {
            scanOnPush: true
        },
        imageTagMutability: "MUTABLE",
        tags: {
            Environment: env,
            Name: repositoryName
        }
    });

    // Create lifecycle policy to limit the number of untagged images
    const lifecyclePolicyName = `${env}-diese-web-app-lifecycle-policy`;
    const lifecyclePolicy = new aws.ecr.LifecyclePolicy(lifecyclePolicyName, {
        repository: repository.name,
        policy: JSON.stringify({
            rules: [{
                rulePriority: 1,
                description: "Keep only 5 untagged images",
                selection: {
                    tagStatus: "untagged",
                    countType: "imageCountMoreThan",
                    countNumber: 5
                },
                action: {
                    type: "expire"
                }
            }]
        })
    });

    return {
        repository,
        lifecyclePolicy
    };
}

export function createMigrationsContainerRegistry(env: string) {
    // Create ECR repository
    const repositoryName = `${env}-diese-web-app-db-migrations-repository`;
    const repository = new aws.ecr.Repository(repositoryName, {
        name: repositoryName,
        imageScanningConfiguration: {
            scanOnPush: true
        },
        imageTagMutability: "MUTABLE",
        tags: {
            Environment: env,
            Name: repositoryName
        }
    });

    // Create lifecycle policy to limit the number of untagged images
    const lifecyclePolicyName = `${env}-diese-web-app-db-migrations-lifecycle-policy`;
    const lifecyclePolicy = new aws.ecr.LifecyclePolicy(lifecyclePolicyName, {
        repository: repository.name,
        policy: JSON.stringify({
            rules: [{
                rulePriority: 1,
                description: "Keep only 5 untagged images",
                selection: {
                    tagStatus: "untagged",
                    countType: "imageCountMoreThan",
                    countNumber: 5
                },
                action: {
                    type: "expire"
                }
            }]
        })
    });

    return {
        repository,
        lifecyclePolicy
    };
}

export default createContainerRegistry;
