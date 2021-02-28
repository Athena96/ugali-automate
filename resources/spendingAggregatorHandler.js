var AWS = require('aws-sdk');
AWS.config.update({
    region: process.env.AWS_REGION
});
var ddb = new AWS.DynamoDB.DocumentClient();

exports.handler = async (event) => {
    console.log("Table: " + process.env.TRANSACTION_TABLE_NAME + " was updated...");
    console.log("DELTA: " + JSON.stringify(event));
    for (const record of event.Records) {
        // todo: pretty inefecient, getting the map every time... could cache the user map, update that...
        //      then do one update at the end for each user. (for is there's multuple txns in same category.)

        console.log("processing: " + JSON.stringify(record));
        console.log('eventName: ' + record.eventName);
        const userEmail = record.eventName === 'REMOVE' ? record.dynamodb.OldImage.user.S : record.dynamodb.NewImage.user.S;
        console.log("get avg data for user: " + userEmail);
        
        var map = await getAvgMapForUser(userEmail);
        console.log(map);

        switch (record.eventName) {
            case 'INSERT':
                const newTransaction = record.dynamodb.NewImage;
                addTransactionToAvgData(newTransaction, map);
                break;
            case 'MODIFY':
                const udpatedTransaction = record.dynamodb.NewImage;
                const previousVersion = record.dynamodb.OldImage;
                modifyTransactionToAvgData(udpatedTransaction, previousVersion, map);
                break;
            case 'REMOVE':
                const transactionToRemove = record.dynamodb.OldImage;
                removeTransactionToAvgData(transactionToRemove, map);
                break;
            default:
              console.log(`error`);
              return;
        }
        console.log('updated map: ' + JSON.stringify(map));
        await putMapForUser(map);
    }
};

async function getAvgMapForUser(userEmail) {
    try {
        var params = {
            TableName: process.env.AVGDATA_TABLE_NAME,
            Key: {
                "user": userEmail
            }
        };
        const result = await ddb.get(params).promise();
        console.log(JSON.stringify(result));
        if (Object.keys(result).length === 0 ) {
            console.log('empty obj');
           return {
            "user":  userEmail,
            "avgSpendingData": { }
            } 
        } else {
            return result.Item;
        }
    } catch (err) {
        console.log(err);
        return {
            "user":  userEmail,
            "avgSpendingData": { }
        };
    }
};

async function putMapForUser(map) {
    var params = {
        Item: map,
        TableName: process.env.AVGDATA_TABLE_NAME
    };
    const result = await ddb.put(params, function(err, data) {
        if (err) console.log(err, err.stack); // an error occurred
        else console.log(data); // successful response
    }).promise();

    console.log("put restuls: " + JSON.stringify(result));
    return result;
};

function addTransactionToAvgData(newTransaction, map) {
    console.log("addTransactionToAvgData");
    console.log(newTransaction);

    const year = getYearFrom(newTransaction);
    const month = getMonthFrom(newTransaction);

    console.log(year, month);

    if (map["avgSpendingData"][year] === undefined) {
        console.log("no year, adding year to map")
        map["avgSpendingData"][year] = {
        };
    }
    if (map["avgSpendingData"][year][month] === undefined) {
        console.log("no month, adding month to map")

        map["avgSpendingData"][year][month] = {
            ccSum: 0.0
        };
    }
    if (map["avgSpendingData"][year][month][newTransaction.category.S] === undefined) {
        console.log("no category, adding category to map")
        map["avgSpendingData"][year][month][newTransaction.category.S] = {
            count: 0,
            sum: 0.0
        };
    }

    if (map["avgSpendingData"][year][month]["ccSum"] === undefined) {
        console.log("adding cc sum field to existing mo/yr");
        map["avgSpendingData"][year][month]["ccSum"] = 0.0;
    }

    map["avgSpendingData"][year][month][newTransaction.category.S].count += 1;
    console.log(typeof newTransaction.amount.N);
    console.log("newTransaction.amount.N: " + newTransaction.amount.N);

    map["avgSpendingData"][year][month][newTransaction.category.S].sum += parseFloat(newTransaction.amount.N);

    if (isCCExpense(newTransaction)) {
        console.log("increment sum data if cc txn");
        console.log(JSON.stringify(newTransaction));
        map["avgSpendingData"][year][month]["ccSum"] += parseFloat(newTransaction.amount.N);
    }
};

function modifyTransactionToAvgData(udpatedTransaction, previousVersion, map) {
    console.log("modifyTransactionToAvgData");
    const prevYear = getYearFrom(previousVersion);
    const prevMonth = getMonthFrom(previousVersion);

    console.log("subtract amount and count from the previous entry");
    map["avgSpendingData"][prevYear][prevMonth][previousVersion.category.S].sum -= parseFloat(previousVersion.amount.N);
    map["avgSpendingData"][prevYear][prevMonth][previousVersion.category.S].count -= 1;

    // if the resulting count is 0... then the user likely created a new category by accident... 
    // so remove it from the map to keep things clean.
    if (map["avgSpendingData"][prevYear][prevMonth][previousVersion.category.S].count === 0) {
        delete map["avgSpendingData"][prevYear][prevMonth][previousVersion.category.S];
    }

    const updatedYear = getYearFrom(udpatedTransaction);
    const updatedMonth = getMonthFrom(udpatedTransaction);
    if (map["avgSpendingData"][updatedYear] === undefined) {
        map["avgSpendingData"][updatedYear] = {
        };
    }
    if (map["avgSpendingData"][updatedYear][updatedMonth] === undefined) {
        map["avgSpendingData"][updatedYear][updatedMonth] = {
        };
    }
    if (map["avgSpendingData"][updatedYear][updatedMonth][udpatedTransaction.category.S] === undefined) {
        map["avgSpendingData"][updatedYear][updatedMonth][udpatedTransaction.category.S] = {
            count: 0,
            sum: 0.0
        };
    }
    map["avgSpendingData"][updatedYear][updatedMonth][udpatedTransaction.category.S].sum += parseFloat(udpatedTransaction.amount.N);

    // todo add logic here.
};

function removeTransactionToAvgData(transactionToRemove, map) {
    console.log("removeTransactionToAvgData");
    const year = getYearFrom(transactionToRemove);
    const month = getMonthFrom(transactionToRemove);
    map["avgSpendingData"][year][month][transactionToRemove.category.S].count -= 1;
    map["avgSpendingData"][year][month][transactionToRemove.category.S].sum -= parseFloat(transactionToRemove.amount.N);

    if (isCCExpense(transactionToRemove)) {
        console.log("remove sum data");
        console.log(JSON.stringify(transactionToRemove));
        if (map["avgSpendingData"][year][month]["ccSum"] !== undefined) {
            let currVal = map["avgSpendingData"][year][month]["ccSum"];
            console.log(currVal);
            console.log(typeof currVal);
            let newVal = currVal -= parseFloat(transactionToRemove.amount.N);
            console.log("newVal: " + newVal);
            if (newVal >= 0) {
                map["avgSpendingData"][year][month]["ccSum"] -= parseFloat(transactionToRemove.amount.N);
            }
        }
    }
};

function getYearFrom(transaction) {
    return transaction.date.S.split('-')[0];
}

function getMonthFrom(transaction) {
    return transaction.date.S.split('-')[1];
}

function isCCExpense(transaction) {
    return transaction.payment_method.S === "credit" && transaction.type.N === "2";
}