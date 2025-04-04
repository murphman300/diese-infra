import * as aws from "@pulumi/aws";
import { Secret } from "@pulumi/aws/secretsmanager";
import * as pulumi from "@pulumi/pulumi";
import { config } from "process";

export function createEcsCluster(env: string, ecrImageUri: string, dbSecretObject: Secret) {
    
    const config = new pulumi.Config();
    // Create an ECS cluster for Fargate
    const cluster = new aws.ecs.Cluster(`diese-cluster-${env}`, {
        name: `diese-cluster-${env}`,
        tags: {
            Name: `diese-cluster-${env}`,
            Environment: env
        }
    });

    // Create a task execution role for Fargate - this role is used by ECS itself
    const taskExecutionRole = new aws.iam.Role(`diese-task-execution-role-${env}`, {
        assumeRolePolicy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [{
                Action: "sts:AssumeRole",
                Effect: "Allow",
                Principal: {
                    Service: "ecs-tasks.amazonaws.com"
                }
            }]
        }),
        description: "Role that the ECS service uses to execute tasks",
        tags: {
            Name: `diese-task-execution-role-${env}`,
            Environment: env
        }
    });

    // Create a task role for Fargate - this role is used by the application
    const taskRole = new aws.iam.Role(`diese-task-role-${env}`, {
        assumeRolePolicy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [{
                Action: "sts:AssumeRole",
                Effect: "Allow",
                Principal: {
                    Service: "ecs-tasks.amazonaws.com"
                }
            }]
        }),
        description: "Role that the application within the ECS container assumes",
        tags: {
            Name: `diese-task-role-${env}`,
            Environment: env
        }
    });

    // Attach the ECS Task Execution policy to the task execution role
    // This policy allows ECS to pull container images and publish logs
    new aws.iam.RolePolicyAttachment(`diese-task-execution-policy-${env}`, {
        role: taskExecutionRole.name,
        policyArn: "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
    });

    // Create a secrets manager secret for the application
    const secret = new aws.secretsmanager.Secret(`diese-web-app-secrets-${env}`, {
        name: `diese-web-app-secrets-${env}`,
        description: `Secrets for the diese application in ${env} environment`,
        tags: {
            Environment: env,
            Name: `diese-web-app-secrets-${env}`
        }
    });

    // Initialize the secret with default values
    const secretValues = {
        API_KEY: env === "production" ? "TO_BE_REPLACED_IN_PRODUCTION" : "dev-api-key-example",
        JWT_SECRET: env === "production" ? "TO_BE_REPLACED_IN_PRODUCTION" : pulumi.interpolate`jwt-secret-${pulumi.getStack()}-${Date.now()}`,
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_" + (env === "production" ? "TO_BE_REPLACED_IN_PRODUCTION" : "clerk-dev-key-example"),
        CLERK_SECRET_KEY: "sk_test_" + (env === "production" ? "TO_BE_REPLACED_IN_PRODUCTION" : "clerk-dev-secret-example"),
        GEMINI_API_KEY: env === "production" ? "TO_BE_REPLACED_IN_PRODUCTION" : "gemini-dev-key-example",
        GROQ_API_KEY: env === "production" ? "TO_BE_REPLACED_IN_PRODUCTION" : "groq-dev-key-example",
        OPENAI_API_KEY: env === "production" ? "TO_BE_REPLACED_IN_PRODUCTION" : "sk-openai-dev-key-example"
    };

    // Create a secret version with the values
    const secretVersion = new aws.secretsmanager.SecretVersion(`diese-web-app-secret-version-${env}`, {
        secretId: secret.id,
        secretString: JSON.stringify(secretValues)
    });

    // Get reference to existing DB secret
    const dbSecret = dbSecretObject;

    // Create a more specific policy for Secrets Manager access for the task execution role
    // This is more secure than using the ReadOnly managed policy
    const secretsAccessPolicy = new aws.iam.Policy(`diese-secrets-access-policy-${env}`, {
        description: "Policy granting access to specific secrets for the task",
        policy: pulumi.all([secret.arn, dbSecret.arn]).apply(([secretArn, dbSecretArn]) => JSON.stringify({
            Version: "2012-10-17",
            Statement: [
                {
                    Effect: "Allow",
                    Action: [
                        "secretsmanager:GetSecretValue"
                    ],
                    Resource: [
                        secretArn,
                        dbSecretArn
                    ]
                }
            ]
        }))
    });

    // Attach the Secrets Manager access policy to the task execution role
    new aws.iam.RolePolicyAttachment(`diese-secrets-policy-attachment-${env}`, {
        role: taskExecutionRole.name,
        policyArn: secretsAccessPolicy.arn
    });

    // Create CloudWatch log group for container logs
    const logGroup = new aws.cloudwatch.LogGroup(`diese-log-group-${env}`, {
        name: `/ecs/diese-${env}`,
        retentionInDays: 30
    });

    // Create CloudWatch logs policy for the task role
    const logsPolicy = new aws.iam.Policy(`diese-logs-policy-${env}`, {
        description: "Policy allowing task to write logs to CloudWatch",
        policy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [
                {
                    Effect: "Allow",
                    Action: [
                        "logs:CreateLogStream",
                        "logs:PutLogEvents"
                    ],
                    Resource: `arn:aws:logs:*:*:log-group:/ecs/diese-${env}:*`
                }
            ]
        })
    });

    // Attach the logs policy to the task role
    new aws.iam.RolePolicyAttachment(`diese-logs-policy-attachment-${env}`, {
        role: taskRole.name,
        policyArn: logsPolicy.arn
    });

    // Determine CPU and memory based on environment
    let cpu = "256";
    let memory = "512";

    
    let authorizedDomains: string[] = config.requireObject<string[]>("authorized_domains") || [];

    // Set higher resources for staging and production environments
    if ( env === "production") {
        cpu = "1024"
        memory = "2048"
    }

    // Create task definition for Fargate
    const taskDefinition = new aws.ecs.TaskDefinition(`diese-task-definition-${env}`, {
        family: `diese-task-${env}`,
        cpu: cpu,
        memory: memory,
        networkMode: "awsvpc",
        requiresCompatibilities: ["FARGATE"],
        executionRoleArn: taskExecutionRole.arn,
        taskRoleArn: taskRole.arn, // Assign the task role to the task definition
        containerDefinitions: JSON.stringify([{
            name: `diese-container-${env}`,
            image: ecrImageUri,
            essential: true,
            portMappings: [{
                containerPort: 80,
                hostPort: 80,
                protocol: "tcp"
            }],
            logConfiguration: {
                logDriver: "awslogs",
                options: {
                    "awslogs-group": `/ecs/diese-${env}`,
                    "awslogs-region": aws.config.region || "us-east-1",
                    "awslogs-stream-prefix": "ecs"
                }
            },
            secrets: [
                {
                    name: "API_KEY",
                    valueFrom: secret.arn + ":API_KEY::"
                },
                {
                    name: "JWT_SECRET",
                    valueFrom: secret.arn + ":JWT_SECRET::"
                },
                // Identity Provider Secrets
                {
                    name: "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
                    valueFrom: secret.arn + ":NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"
                },
                {
                    name: "CLERK_SECRET_KEY",
                    valueFrom: secret.arn + ":CLERK_SECRET_KEY"
                },
                // LLM Secrets
                {
                    name: "GEMINI_API_KEY",
                    valueFrom: secret.arn + ":GEMINI_API_KEY"
                },
                {
                    name: "GROQ_API_KEY",
                    valueFrom: secret.arn + ":GROQ_API_KEY"
                },
                {
                    name: "OPENAI_API_KEY",
                    valueFrom: secret.arn + ":OPENAI_API_KEY"
                },
                // DB secrets
                {
                    name: "DB_USERNAME",
                    valueFrom: dbSecret.arn + ":DB_USERNAME"
                },
                {
                    name: "DB_PASSWORD",
                    valueFrom: dbSecret.arn + ":DB_PASSWORD"
                },
                {
                    name: "DB_HOST",
                    valueFrom: dbSecret.arn + ":DB_HOST"
                },
                {
                    name: "DB_PORT",
                    valueFrom: dbSecret.arn + ":DB_PORT"
                },
                {
                    name: "DB_NAME",
                    valueFrom: dbSecret.arn + ":DB_NAME"
                }
            ],
            environment: [
                {
                    name: "NODE_ENV",
                    value: env
                },
                {
                    name: "PORT",
                    value: "80"
                },
                {
                    name: "AUTHORIZED_DOMAINS",
                    value: authorizedDomains.join(",")
                }
            ]
        }])
    });

    // Create auto scaling target for the Fargate service
    type AutoScalingResources = {
        service: aws.ecs.Service;
        scalingTarget: aws.appautoscaling.Target;
        cpuScaling: aws.appautoscaling.Policy;
        memoryScaling: aws.appautoscaling.Policy;
    } | null;
    
    let autoScalingResources: AutoScalingResources = null;
    
    if (env === "staging" || env === "production") {
        // Create the ECS service first to attach auto scaling to
        const service = new aws.ecs.Service(`diese-service-${env}`, {
            cluster: cluster.arn,
            desiredCount: env === "production" ? 1 : 1,
            launchType: "FARGATE",
            taskDefinition: taskDefinition.arn,
            networkConfiguration: {
                assignPublicIp: true,
                subnets: [], // TODO: Add subnet IDs
                securityGroups: [] // TODO: Add security group IDs
            },
            platformVersion: "LATEST",
            schedulingStrategy: "REPLICA",
            deploymentMinimumHealthyPercent: 100,
            deploymentMaximumPercent: 200
        });

        // Create auto scaling target
        const scalingTarget = new aws.appautoscaling.Target(`diese-scaling-target-${env}`, {
            maxCapacity: env === "production" ? 10 : 2,
            minCapacity: 1,
            resourceId: pulumi.interpolate`service/${cluster.name}/${service.name}`,
            scalableDimension: "ecs:service:DesiredCount",
            serviceNamespace: "ecs"
        });

        // Create CPU scaling policy
        const cpuScaling = new aws.appautoscaling.Policy(`diese-cpu-scaling-${env}`, {
            policyType: "TargetTrackingScaling",
            resourceId: scalingTarget.resourceId,
            scalableDimension: scalingTarget.scalableDimension,
            serviceNamespace: scalingTarget.serviceNamespace,
            targetTrackingScalingPolicyConfiguration: {
                predefinedMetricSpecification: {
                    predefinedMetricType: "ECSServiceAverageCPUUtilization"
                },
                targetValue: 70.0,
                scaleInCooldown: 300,
                scaleOutCooldown: 60
            }
        });

        // Create memory scaling policy
        const memoryScaling = new aws.appautoscaling.Policy(`diese-memory-scaling-${env}`, {
            policyType: "TargetTrackingScaling",
            resourceId: scalingTarget.resourceId,
            scalableDimension: scalingTarget.scalableDimension,
            serviceNamespace: scalingTarget.serviceNamespace,
            targetTrackingScalingPolicyConfiguration: {
                predefinedMetricSpecification: {
                    predefinedMetricType: "ECSServiceAverageMemoryUtilization"
                },
                targetValue: 80.0,
                scaleInCooldown: 300,
                scaleOutCooldown: 60
            }
        });

        autoScalingResources = {
            service,
            scalingTarget,
            cpuScaling,
            memoryScaling
        };
    }

    return {
        cluster,
        taskDefinition,
        taskExecutionRole,
        taskRole,
        logGroup,
        secret,
        secretVersion,
        dbSecret,
        autoScalingResources
    };
}
