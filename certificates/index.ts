import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

export interface CertificateResources {
    webAppCertificate: pulumi.Output<aws.acm.Certificate>;
    webAppCertificateValidation: pulumi.Output<aws.acm.CertificateValidation>;
}

export function createCertificates(env: string): CertificateResources {
    const config = new pulumi.Config();
    const webAppDomain = config.require("web_app_domain");
    // Create ACM certificate for staging.diese.ai
    const name = `${env}-diese-certificate`;
    const webAppCertificate = new aws.acm.Certificate(name, {
        domainName: webAppDomain,
        validationMethod: "DNS",
        tags: {
            Environment: env,
            Name: `${env}-diese-certificate`
        }
    });

    // Create validation record
    const webAppCertificateValidationName = `${env}-diese-certificate-validation`;
    const webAppCertificateValidation = new aws.acm.CertificateValidation(webAppCertificateValidationName, {
        certificateArn: webAppCertificate.arn,
        validationRecordFqdns: webAppCertificate.domainValidationOptions.apply(
            options => options.map(option => option.resourceRecordName)
        )
    });

    return {
        webAppCertificate: pulumi.output(webAppCertificate),
        webAppCertificateValidation: pulumi.output(webAppCertificateValidation)
    };
}

export default createCertificates;
