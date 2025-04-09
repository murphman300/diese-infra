import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { SecretNames } from "./secretNames";
/**
 * Creates multiple AWS Secrets Manager secrets.
 * @param env The deployment environment (e.g., 'staging', 'production').
 * @param opts Optional Pulumi custom resource options.
 * @returns A record mapping the original secret name to the created Secret resource.
 */
export function createSecrets(
    env: string,
    opts?: pulumi.CustomResourceOptions 
): Record<string, aws.secretsmanager.Secret> {
    const secrets: Record<string, aws.secretsmanager.Secret> = {};

    for (const secretName of Object.values(SecretNames)) {
        const resourceName = `${env}-${secretName.toLowerCase().replace(/_/g, '-')}-secret`;

        secrets[secretName] = new aws.secretsmanager.Secret(resourceName, {
            name: resourceName,
            description: `Secret for ${secretName} in ${env} environment`,
            tags: {
                Name: resourceName,
                Environment: env,
                ManagedBy: "pulumi"
            }
        }, opts);
    }

    return secrets;
} 