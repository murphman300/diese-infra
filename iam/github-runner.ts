import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

export function createGitHubRunnerIAMResources(env: string) {
    // Create IAM user for GitHub Actions
    const githubActionsUserName = `${env}-github-actions-ecs-user`;
    const githubActionsUser = new aws.iam.User(githubActionsUserName, {
        name: githubActionsUserName,
        path: "/github-actions/"
    });

    // Create access keys for the user
    const githubActionsUserKeysName = `${env}-github-actions-user-keys`;
    const githubActionsUserKeys = new aws.iam.AccessKey(githubActionsUserKeysName, {
        user: githubActionsUser.name
    });

    // Create policy for ECS and ECR deployments
    const ecsDeploymentPolicyName = `${env}-ecs-deployment-policy`;
    const ecsDeploymentPolicy = new aws.iam.Policy(ecsDeploymentPolicyName, {
        name: ecsDeploymentPolicyName,
        description: "Policy for GitHub Actions to deploy to ECS and ECR",
        policy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [
                {
                    Effect: "Allow",
                    Action: [
                        // ECS permissions for service management
                        "ecs:DescribeServices",
                        "ecs:DescribeTaskDefinition",
                        "ecs:DescribeTasks",
                        "ecs:ListTasks",
                        "ecs:RegisterTaskDefinition",
                        "ecs:UpdateService",
                        "ecs:DeleteService",
                        "ecs:CreateService",
                        "ecs:ListServices",
                        // Deployment and rollback specific permissions
                        "ecs:DeregisterTaskDefinition",
                        "ecs:DescribeTaskSets",
                        "ecs:UpdateServicePrimaryTaskSet",
                        "ecs:CreateTaskSet",
                        "ecs:DeleteTaskSet",
                        "ecs:UpdateTaskSet",
                        "ecs:StopTask",
                        "ecs:RunTask",
                        "ecs:StartTask",
                        // Cluster permissions
                        "ecs:DescribeClusters",
                        "ecs:ListClusters",
                        // IAM permissions needed for task execution
                        "iam:PassRole",
                        "iam:GetRole",
                        "iam:ListRoles",
                        "iam:ListInstanceProfiles",
                        // Full ECR permissions for repository management and image operations
                        "ecr:CreateRepository",
                        "ecr:DeleteRepository",
                        "ecr:DescribeRepositories",
                        "ecr:ListRepositories",
                        "ecr:GetRepositoryPolicy",
                        "ecr:SetRepositoryPolicy",
                        "ecr:DeleteRepositoryPolicy",
                        "ecr:GetAuthorizationToken",
                        "ecr:BatchCheckLayerAvailability",
                        "ecr:GetDownloadUrlForLayer",
                        "ecr:GetRepositoryPolicy",
                        "ecr:DescribeRepositories",
                        "ecr:ListImages",
                        "ecr:DescribeImages",
                        "ecr:BatchGetImage",
                        "ecr:PutImage",
                        "ecr:InitiateLayerUpload",
                        "ecr:UploadLayerPart",
                        "ecr:CompleteLayerUpload",
                        "ecr:BatchDeleteImage",
                        "ecr:TagResource",
                        "ecr:UntagResource",
                        // Permissions for repository scanning and lifecycle policies
                        "ecr:PutImageScanningConfiguration",
                        "ecr:StartImageScan",
                        "ecr:GetImageScanFindings",
                        "ecr:PutLifecyclePolicy",
                        "ecr:GetLifecyclePolicy",
                        "ecr:DeleteLifecyclePolicy"
                    ],
                    Resource: "*"
                }
            ]
        })
    });

    // Attach the policy to the user
    const policyAttachmentName = `${env}-ecs-policy-attachment`;
    const policyAttachment = new aws.iam.UserPolicyAttachment(policyAttachmentName, {
        user: githubActionsUser.name,
        policyArn: ecsDeploymentPolicy.arn
    });

    return {
        accessKeyId: githubActionsUserKeys.id,
        secretAccessKey: githubActionsUserKeys.secret,
        policyAttachment,
        ecsDeploymentPolicy,
        githubActionsUser,
        githubActionsUserKeys
    };
} 