import * as aws from "@pulumi/aws";
import { Output } from "@pulumi/pulumi";
import * as pulumi from "@pulumi/pulumi";
import { S3Buckets } from "./buckets";
import { createS3Buckets, S3ResourcesProperties } from "./createS3Bucket";
import { CreateEC2Resources } from "../ec2";
import { RolePolicy } from "@pulumi/aws/iam";
import { GitHubRunnerIAMResources } from "../iam/github-runner";
    
export interface S3BucketCompleteResources extends S3ResourcesProperties {
    trustedArns: Output<RolePolicy>;
    writeAccessPolicy: Output<RolePolicy>;
    ec2WritePolicy: Output<RolePolicy>;
    githubUserPolicy?: Output<aws.iam.UserPolicy>;
}

export type S3BucketsResources = {
    [key in S3Buckets]: S3BucketCompleteResources;
};

export function declareS3Buckets(
    env: string, 
    ec2: CreateEC2Resources, 
    githubRunner?: GitHubRunnerIAMResources,
    s3VpcEndpoint?: Output<aws.ec2.VpcEndpoint>
): S3BucketsResources {
    const appsBucket = createS3Buckets(S3Buckets.apps, env);
    
    const appsBucketTrustedArns = appsBucket.addTrustedArnsToRole([], [ec2.resources.securityGroup.arn]);

    const appsBucketWriteAccessPolicy = appsBucket.addWriteAccessPolicy([], [ec2.resources.securityGroup.arn], s3VpcEndpoint);

    // Create EC2 role policy using the addWriteAccessPolicyForAdHocRole function
    const ec2WritePolicy = appsBucket.addWriteAccessPolicyForAdHocRole(
        ec2.resources.instanceRole, 
        "ec2-bastion-host"
    );

    // Create policy for GitHub runner to access S3 bucket if provided
    let githubUserPolicy: Output<aws.iam.UserPolicy> | undefined;
    let s3BucketResources: S3BucketCompleteResources = {
        bucket: appsBucket.bucket,
        readGetPullRole: appsBucket.readGetPullRole,
        readGetPullPolicy: appsBucket.readGetPullPolicy,
        trustedArns: appsBucketTrustedArns,
        writeAccessPolicy: appsBucketWriteAccessPolicy,
        ec2WritePolicy: ec2WritePolicy
    };
    
    // Only add GitHub policy if runner is defined
    if (githubRunner && githubRunner.githubActionsUser) {
        console.log("GitHub Runner found, creating user policy");
        
        // Create the GitHub user policy
        githubUserPolicy = appsBucket.addWriteAccessPolicyForUser(
            githubRunner.githubActionsUser,
            "github-actions-user"
        );
        
        // Add the policy to the resources
        s3BucketResources.githubUserPolicy = githubUserPolicy;
    } else {
        console.log("No GitHub Runner provided, skipping user policy creation");
    }

    // Return the complete resources
    return {
        [S3Buckets.apps]: s3BucketResources
    };
}