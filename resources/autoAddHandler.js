var AWS = require('aws-sdk');
var ddb = new AWS.DynamoDB({ apiVersion: '2012-08-10', region: process.env.AWS_REGION });

const LIMITS = '100';

function getLastDayOfMonthFromDate(currentDay) {
    var lastDateOfMonth = new Date(currentDay.getFullYear(), currentDay.getMonth() + 1, 0);
    return lastDateOfMonth.getDate()
}

function datediff(first, second) {
    return Math.round((second - first) / (1000 * 60 * 60 * 24));
}

function getDoubleDigitFormat(number) {
    return (number < 10) ? "0" + number : number;
}

function convertDateStrToGraphqlDate(dateStr) {
    var dateParts = dateStr.split('-');
    if (dateParts.length >= 3) {
        var year = dateParts[0];
        var month = dateParts[1];
        var day = dateParts[2];

        var currTime = new Date();
        currTime.toLocaleString('en-US', { timeZone: 'America/los_angeles' })
        currTime.setHours(currTime.getHours() - 7);
        var hour = getDoubleDigitFormat(currTime.getHours());
        var min = getDoubleDigitFormat(currTime.getMinutes());
        var sec = getDoubleDigitFormat(currTime.getSeconds());
        var formattedString = year + '-' + month + '-' + day + 'T' + hour + ':' + min + ':' + sec + '.000Z';
        return formattedString;
    }
}

async function addTxn(txn, currentDay) {
    console.log("addTxn!");
    console.log(txn);

    var newDate = convertDateStrToGraphqlDate(currentDay.getFullYear() + "-" + getDoubleDigitFormat(currentDay.getUTCMonth() + 1) + "-" + getDoubleDigitFormat(currentDay.getUTCDate()));

    // udpate Date
    txn.date.S = newDate;

    // update createdDate
    txn.createdAt.S = newDate;

    // update updatedAt
    txn.updatedAt.S = newDate;

    // update is recurring
    txn.is_recurring.S = "false";

    // update recurring frequency
    txn.recurring_frequency.S = "NA";

    // update title
    const originalTitle = txn.title.S;
    txn.title.S = "[AUTO ADDED] " + originalTitle;

    // save original parent ID
    const baseTxnId = txn.id.S;

    // update key id
    txn.id.S = "" + (new Date()).getTime();

    console.log(txn);
    console.log("FINAL");
    
    var params = {
        Item: {
            "id": {
                S: txn.id.S
            },
            "__typename": txn.__typename,
            "description": txn.description,
            "amount": {
                N: txn.amount.N
            },
            "category": {
                S: txn.category.S
            },
            "createdAt": {
                S: txn.createdAt.S
            },
            "updatedAt": {
                S: txn.updatedAt.S
            },
            "date": {
                S: txn.date.S
            },
            "is_recurring": {
                S: txn.is_recurring.S
            },
            "is_public": {
                S: txn.hasOwnProperty("is_public") ? txn.is_public.S : "false"
            },
            "payment_method": {
                S: txn.payment_method.S
            },
            "recurring_frequency": {
                S: txn.recurring_frequency.S
            },
            "base_recurring_transaction": {
                S: baseTxnId
            },
            "title": {
                S: txn.title.S
            },
            "type": {
                N: txn.type.N
            },
            "user": {
                S: txn.user.S
            }
        },
        ReturnConsumedCapacity: "TOTAL",
        TableName: process.env.TRANSACTION_TABLE_NAME
    };

    await ddb.putItem(params, function(err, data) {
        if (err) console.log(err, err.stack); // an error occurred
        else console.log(data); // successful response
    }).promise();
}

async function getAllPremiumUsers() {
    const params = {
        TableName: process.env.PREMIUM_USER_TABLE_NAME,
        Limit: LIMITS
    };

    let scanResults = [];
    let items;
    do {
        items = await ddb.scan(params).promise();
        items.Items.forEach((item) => scanResults.push(item));
        params.ExclusiveStartKey = items.LastEvaluatedKey;
    } while (items.LastEvaluatedKey !== undefined);

    return scanResults;
}

async function getAllRecurringTransactions() {
    const params = {
        TableName: process.env.TRANSACTION_TABLE_NAME,
        ExpressionAttributeValues: {
            ':s': { S: 'true' },
        },
        FilterExpression: 'contains (is_recurring, :s)',
        Limit: LIMITS
    };

    let scanResults = [];
    let items;
    do {
        items = await ddb.scan(params).promise();
        items.Items.forEach((item) => scanResults.push(item));
        params.ExclusiveStartKey = items.LastEvaluatedKey;
    } while (items.LastEvaluatedKey !== undefined);

    return scanResults;
}

exports.handler = async(event) => {

    var currentDay = new Date();
    console.log(currentDay);
    var premiumUsers = await getAllPremiumUsers();

    var recurringTxnsToAdd = [];
    await getAllRecurringTransactions().then(function(recurringTransactions) {

        for (var premiumUser of premiumUsers) {
            const user = premiumUser.user.S;

            for (var recurringTransaction of recurringTransactions) {
                const recurrTxnUser = recurringTransaction.user.S;
                if (recurrTxnUser === user) {
                    var recurrTxnDay = parseInt(recurringTransaction.date.S.split('-')[2].split('T')[0]);
                    var recurrTxnMonth = parseInt(recurringTransaction.date.S.split('-')[1]);
                    var recurrTxnYear = parseInt(recurringTransaction.date.S.split('-')[0]);

                    console.log("SAME DAY");
                    const frequency = recurringTransaction.recurring_frequency.S;
                    console.log(recurringTransaction);

                    if (frequency !== "ONCE") {

                        if (frequency === "MONTHLY") {

                            if (recurrTxnDay === currentDay.getDate()) {

                                console.log(recurrTxnMonth)
                                console.log((currentDay.getMonth() + 1))
                                console.log(typeof recurrTxnYear)
                                console.log(typeof currentDay.getFullYear())

                                if (recurrTxnMonth !== (currentDay.getMonth() + 1)) {
                                    // if month is diff - add

                                    // addTxn(recurringTransaction, currentDay);
                                    console.log("ADDING A");

                                    recurringTxnsToAdd.push([recurringTransaction, currentDay])
                                } else if ((recurrTxnMonth === (currentDay.getMonth() + 1)) && recurrTxnYear !== currentDay.getFullYear()) {
                                    // if month is same and year is diff - add
                                    // add()
                                    // addTxn(recurringTransaction, currentDay);
                                    console.log("ADDING B");
                                    recurringTxnsToAdd.push([recurringTransaction, currentDay])

                                }
                            }
                        } else if (frequency === "YEARLY") {
                            if (recurrTxnDay === currentDay.getDate()) {
                                // if month is same and year is diff - add
                                if ((recurrTxnMonth === (currentDay.getMonth() + 1)) && recurrTxnYear !== currentDay.getFullYear()) {
                                    // if month is same and year is diff - add
                                    // add()
                                    // addTxn(recurringTransaction, currentDay);
                                    console.log("ADDING C");
                                    recurringTxnsToAdd.push([recurringTransaction, currentDay]);
                                }
                            }
                        } else if (frequency === "WEEKLY") {
                            var dtObj = new Date(recurringTransaction.date);
                            if (dtObj.getDay() === currentDay.getDay()) {
                                recurringTxnsToAdd.push([recurringTransaction, currentDay]);
                            }
                        } else if (frequency === "BIWEEKLY") {
                            var dtObj = new Date(recurringTransaction.date);
                            if (dtObj.getDay() === currentDay.getDay() && (datediff(dtObj, currentDay) % 14 === 0)) {
                                recurringTxnsToAdd.push([recurringTransaction, currentDay]);
                            }
                        } else if (frequency === "FIRST_DAY_OF_MONTH") {
                            if (currentDay.getDate() === 1) {
                                recurringTxnsToAdd.push([recurringTransaction, currentDay]);
                            }
                        } else if (frequency === "LAST_DAY_OF_MONTH") {
                            const lastDayOfCurrentMonth = getLastDayOfMonthFromDate(currentDay);
                            if (currentDay.getDate() === lastDayOfCurrentMonth) {
                                recurringTxnsToAdd.push([recurringTransaction, currentDay]);
                            }
                        }
                    }

                }
            }
        }
    });


    if (recurringTxnsToAdd.length !== 0) {
        console.log("adding txns now...");
        for (var txP of recurringTxnsToAdd) {
            await addTxn(txP[0], txP[1]);
        }
    } else {
        console.log("no txns to add");
    }

    console.log("end");

};