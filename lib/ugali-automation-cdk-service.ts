import * as core from "@aws-cdk/core";
import * as lambda from "@aws-cdk/aws-lambda";
import * as iam from "@aws-cdk/aws-iam";
import * as dynamodb from "@aws-cdk/aws-dynamodb";
import * as events from "@aws-cdk/aws-events";
import * as targets from "@aws-cdk/aws-events-targets";

import { Duration } from "@aws-cdk/core";
import { ManagedPolicy } from "@aws-cdk/aws-iam";
import { DynamoEventSource } from '@aws-cdk/aws-lambda-event-sources';
import { Stage } from './ugali-automation-cdk-stack';

const TXN_DEV_NAME = "Transaction-kkgm6iv2yra6rdjcihe4m3sqly-dev";
const TXN_PROD_NAME = "Transaction-hcocoddbajfnlppt72aaktonpe-ugalienv";
const AVG_DATA_DEV_NAME = "AverageSpendingMapTable-dev";
const AVG_DATA_PROD_NAME = "AverageSpendingMapTable-prod";
const PREMIUM_USR_DEV_NAME = "PremiumUsers-kkgm6iv2yra6rdjcihe4m3sqly-dev";
const PREMIUM_USR_PROD_NAME = "PremiumUsers-hcocoddbajfnlppt72aaktonpe-ugalienv";

export class UgaliAutomationService extends core.Construct {
  constructor(scope: core.Construct, id: string, stage: string) {
    super(scope, id);

    const dynamoTable = new dynamodb.Table(this, 'AvgSpendingTable', {
        partitionKey: {
          name: 'user',
          type: dynamodb.AttributeType.STRING
        },
        tableName: stage === Stage.Prod ? AVG_DATA_PROD_NAME : AVG_DATA_DEV_NAME,
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        removalPolicy: core.RemovalPolicy.RETAIN,
        stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES
      });

    const ddbLambdaExecutionRole = new iam.Role(this, 'DDBLambdaExecutionRole', {
        assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      });
    ddbLambdaExecutionRole.addManagedPolicy(
        ManagedPolicy.fromAwsManagedPolicyName('AmazonDynamoDBFullAccess')
    );
    ddbLambdaExecutionRole.addManagedPolicy(
        ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
    );
    const averageSpendingAggregator = new lambda.Function(this, "UgaliAverageSpendingAggregatorFunction", {
      runtime: lambda.Runtime.NODEJS_12_X, // So we can use async in widget.js
      code: lambda.Code.fromAsset("resources"),
      handler: "autoAddHandler.handler",
      timeout: Duration.seconds(300),
      role: ddbLambdaExecutionRole,
      environment: {
        ENVIRONMENT: stage,
        TRANSACTION_TABLE_NAME: stage === Stage.Prod ? TXN_PROD_NAME : TXN_DEV_NAME,
        AVGDATA_TABLE_NAME: stage === Stage.Prod ? AVG_DATA_PROD_NAME : AVG_DATA_DEV_NAME
      }
    });
    averageSpendingAggregator.addEventSource(new DynamoEventSource(dynamoTable, {
        startingPosition: lambda.StartingPosition.LATEST,
        batchSize: 1,
      }));
      
    const transactionAutoAdder = new lambda.Function(this, "UgaliAutoAddFunction", {
        runtime: lambda.Runtime.NODEJS_12_X, // So we can use async in widget.js
        code: lambda.Code.fromAsset("resources"),
        handler: "spendingAggregatorHandler.handler",
        timeout: Duration.seconds(300),
        role: ddbLambdaExecutionRole,
        environment: {
            ENVIRONMENT: stage,
            TRANSACTION_TABLE_NAME: stage === Stage.Prod ? TXN_PROD_NAME : TXN_DEV_NAME,
            AVGDATA_TABLE_NAME: stage === Stage.Prod ? AVG_DATA_PROD_NAME : AVG_DATA_DEV_NAME,
            PREMIUM_USER_TABLE_NAME: stage === Stage.Prod ? PREMIUM_USR_PROD_NAME : PREMIUM_USR_DEV_NAME
        }
    });


    const rule = new events.Rule(this, 'Rule', {
        description: "Once a day at 4am PST",
        schedule: events.Schedule.expression('cron(50 11 * * ? *)')
    });
  
    rule.addTarget(new targets.LambdaFunction(transactionAutoAdder));



  }
}