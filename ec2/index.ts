import { createEC2Resources } from "./configuration";
import { createEC2Instances } from "./instances";
import { EcsClusterResources } from "../webapp";
import { DatabaseResources } from "../databases";

export function createEC2(env: string, cluster: EcsClusterResources, databases: DatabaseResources) {
    const name = `${env}-ec2-bastion-host`;
    const resources = createEC2Resources(name, env, cluster);
    const instances = createEC2Instances(env, resources, cluster, databases);
    return { resources, instances };
}