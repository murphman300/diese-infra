// import * as aws from "@pulumi/aws";

// export function createLightsailApplication(env: string, containerRegistryName: string) {
//     const appName = `${env}-diese-web-app`;
    
//     const lightsailApp = new aws.lightsail.ContainerService(appName, {
//         name: appName,
//         power: "micro",
//         scale: 1,
//         tags: {
//             Environment: env,
//             Name: appName
//         },
//         containers: {
//             webapp: {
//                 image: `${containerRegistryName}:latest`,
//                 ports: {
//                     "80": "HTTP"
//                 },
//                 environment: {
//                     "NODE_ENV": env
//                 }
//             },
//             publicEndpoint: {
//                 containerName: "webapp",
//                 containerPort: 80,
//                 healthCheck: {
//                     healthyThreshold: 2,
//                     unhealthyThreshold: 2,
//                     timeoutSeconds: 2,
//                     intervalSeconds: 5,
//                     path: "/api/health",
//                     successCodes: "200-299"
//                 }
//             }
//         }
//     });

//     return {
//         lightsailApp
//     };
// }

// export default createLightsailApplication;

