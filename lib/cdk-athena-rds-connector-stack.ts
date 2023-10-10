import * as cdk from 'aws-cdk-lib';
import {Construct} from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import {aws_sam as serverless, Fn} from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import {aws_athena as athena} from 'aws-cdk-lib';
import { Stack } from "aws-cdk-lib";


export class CdkAthenaRdsConnectorStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        const dbInstanceEndpointAddress = cdk.Fn.importValue('dbInstanceEndpointAddress-2');
        const dbInstanceEndpointPort = cdk.Fn.importValue('dbInstanceEndpointPort-2');
        const dbSecurityGroupId = cdk.Fn.importValue('dbSecurityGroupId-2');
        const subnetIds = cdk.Fn.split(',', cdk.Fn.importValue('AthenaVpcPublicSubnetsOutput-2'));

        const secretsName = 'rds-db-secrets';
        const LambdaFunctionName = 'athenardsconnect-cdk';
        const bucketName = "my-spill-bucket-237567";


        // Create the Spillage S3 bucket if not already existing:
        new s3.Bucket(this, 'AthenaSpillBucket', {
            bucketName: bucketName,
            versioned: false,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });

        // Define IAM role for the connector
        const connectorRole = new iam.Role(this, 'ConnectorRole', {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
        });

        // Attach policies to the role
        connectorRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'));
        connectorRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonAthenaFullAccess'));
        connectorRole.addToPolicy(new iam.PolicyStatement({
            actions: ["secretsmanager:GetSecretValue"],
            resources: ["*"],
        }));

        const jdbcConnectionString = `postgres://jdbc:postgresql://${dbInstanceEndpointAddress}:${dbInstanceEndpointPort}/my_initial_database?MetadataRetrievalMethod=ProxyAPI&\${${secretsName}}` // Please note that the double literal variable notation is required here or it won't work!
        // + "&sslmode=verify-ca&sslfactory=org.postgresql.ssl.DefaultJavaSSLFactory" // to enable SSL in the connection string uncomment this line

        const connector = new serverless.CfnApplication(this, 'PostgresConnector', {
            location: {
                applicationId: 'arn:aws:serverlessrepo:us-east-1:292517598671:applications/AthenaPostgreSQLConnector',
                semanticVersion: '2023.35.2'
            },
            parameters: {
                "SpillBucket": bucketName,
                // "SecretName": secretsName, // Specify the name or prefix of the secret in Secrets Manager
                "SecretNamePrefix": secretsName,
                // Used to create resource-based authorization policy for "secretsmanager:GetSecretValue" action. E.g. All Athena PostgreSQL Federation secret names can be prefixed with "AthenaPostgreSQLFederation" and authorization policy will allow "arn:${AWS::Partition}:secretsmanager:${AWS::Region}:${AWS::AccountId}:secret:AthenaJdbcFederation*". Parameter value in this case should be "AthenaPostgreSQLFederation". If you do not have a prefix, you can manually update the IAM policy to add allow any secret names.
                LambdaFunctionName, // <-- the function name must start with a lowercase letter and consist only of letters and digits
                // "default": jdbcConnectionString, // If there is a separate postgres catalog connection string please refer to documentation for additional parameters ( or reach out to mim for more info )
                // "postgres_catalog1_connection_string": "", "postgres_catalog2_connection_string": "",
                "DefaultConnectionString": jdbcConnectionString,
                "SecurityGroupIds": dbSecurityGroupId, // Use the security group of the RDS instance
                "SubnetIds": Fn.select(0, subnetIds), // Use one of the public subnets of the VPC
                // "ATHENA_FEDERATION_SDK_LOG_LEVEL": "debug", // -warn // you can add this later to the Lambda function env vars to get more logs!
                // "disable_spill_encryption":  false,
            },
            tags: {
                taggKey: 'tags',
            },
            // timeoutInMinutes: 12, // The amount of time this resource has to return CREATE_COMPLETE or the whole stack will fail.
        });

        // named query:
        const namedQuery = new athena.CfnNamedQuery(this, 'namedQuer_01', {
            database: 'public',
            description: "This is sample named query number 1 for demo purposes!",
            name: "Named query test #1",
            queryString: "SELECT * FROM \"public\".\"combined_all\" limit 10;",
            workGroup: "primary",
        });

        // Athena data catalog: ( please note that in the Console these are called data sources! )
        const connectorLambdaARN = `arn:aws:lambda:${Stack.of(this).region}:${Stack.of(this).account}:function:${LambdaFunctionName}`;
        const cfnDataCatalog = new athena.CfnDataCatalog(this, 'dataSource_01', {
            name: 'data_source_01',
            description: "This is a sample data source",
            parameters: {
                // function: connector.getAtt("Outputs.LambdaArn").toString(),
                function: connectorLambdaARN,
            },
            tags: [{
                key: 'project',
                value: 'Demo',
            }],
            type: "LAMBDA"

        });
        cfnDataCatalog.addDependency(connector);
    }
}
