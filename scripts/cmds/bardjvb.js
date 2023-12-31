const fs = require("fs");
const path = require("path");
const cron = require("node-cron");
const axios = require("axios");
const moment = require('moment-timezone');

const Prefixes = [
  'bard',
  'mj',
  '/rey',
  '?ai',
  '/bard',
  'ask',
  '.chi',
  'chi',
  '¶sammy',
  '_nano',
  'nano',
  'ai',
  '.ask',
  '/ask',
  '!ask',
  '@ask',
  '#ask',
  '$ask',
  '%ask',
  '^ask',
  '*ask',
  '.ai',
  '/ai',
  '!ai',
  '@ai',
  '#ai',
  '$ai',
  '%ai',
  '^ai',
  '*ai',
];

// Define the bannedReturn function to check and respond if the user is banned
async function bannedReturn(api, event, userData) {
  if (userData && userData.banned && userData.banned.status === true) {
    const banReason = userData.banned.reason || "No reason provided";
    const banTime = userData.banned.date || "Unknown date";
    const banMessage = `You are banned.\nReason: ${banReason}\nTime: ${banTime}`;
    await api.sendMessage(banMessage, event.threadID, event.messageID);
    return true; // User is banned
  }
  return false; // User is not banned
}

const limitDuration = 60 * 60 * 1000; // 1 hour in milliseconds
const requestLimit = 150;
const dataFilePath = "requestLimit.json";

let requestCounter = 0;
let lastResetTime = null;

const permission = global.GoatBot.config.adminBot;

module.exports = {
  config: {
    name: "bard",
    aliases: ['ai', 'ask', 'bard'],
    version: "1.0",
    author: "jvbarcenas",
    countDown: 5,
    role: 0,
    shortDescription: {
      vi: "",
      en: "ask bard",
    },
    longDescription: {
      vi: "",
      en: "",
    },
    category: "ai",
  },

  onStart: async function() {},
  onLoad: function() {
    loadRequestData();

    cron.schedule('0 * * * *', () => {
      resetRequestCounter();
    }, {
      timezone: 'Asia/Manila'
    });

    setInterval(() => {
      resetRequestCounter();
    }, 30000); // Call every 30 seconds
  },

  onChat: async function({ api, args, message, getLang, event, usersData }) {
    const { threadID, messageID, senderID } = event;
    const userData = await usersData.get(senderID);
    
    const ikoQuery = await iko(args, event, message);

    const prefix = Prefixes.find((p) => event.body && event.body.toLowerCase().startsWith(p));
    if (!prefix) {
      return;
    }

    const response = event.body.slice(prefix.length).trim();
    // Call the bannedReturn function to check if the user is banned
    if (await bannedReturn(api, event, userData)) {
      return; // Do not proceed to send "😎" if the user is banned.
    }
    
    
    if (requestCounter >= requestLimit) {
      const currentTime = Date.now();
      const timeSinceReset = currentTime - lastResetTime;
      const timeRemaining = limitDuration - timeSinceReset;

      const minutesRemaining = Math.floor(timeRemaining / 60000);
      const secondsRemaining = Math.floor((timeRemaining % 60000) / 1000);

      const countdownMessage = `Request limit exceeded. Please try again in ${minutesRemaining} minutes and ${secondsRemaining} seconds.\n\n(150 requests per hour to avoid being muted by excessive requests)`;

      api.sendMessage(countdownMessage, threadID, messageID);
      return;
    }

    if (!response) {
      api.sendMessage("Please provide a question or query", threadID, messageID);
      return;
    }

    if (!permission.includes(senderID)) {
      const coinsData = loadCoinsData();
      const userCoins = getCoinsBySenderID(coinsData, senderID);

      if (userCoins > 0) {
        deductCoins(coinsData, senderID);
        storeCoinsData(coinsData);
      } else {
        try {
          // Send the "Searching for an answer, please wait..." message first
          api.sendMessage("Searching for an answer, please wait...", threadID, messageID);

          // Define the 'response' variable here
          const response = event.body.slice(prefix.length).trim();

          const res = await axios.get(`https://gptextra.corpselaugh.repl.co/?gpt=${response}${ikoQuery}`);
          const responseData = res.data;

          const { content } = responseData;

          if (content) {
            api.sendMessage(content, threadID, messageID);
          } else {
            api.sendMessage("An error occurred while fetching data from the backup API.", threadID, messageID);
          }

          requestCounter++;
          storeRequestData();
        } catch (backupError) {
          console.error("Error occurred while fetching data from the backup API:", backupError);
          api.sendMessage("An error occurred while searching for an answer.", threadID, messageID);
        }

        return;
      }
    }

    if (!response) {
      api.sendMessage("Please provide a question or query", threadID, messageID);
      return;
    }

    api.sendMessage("Searching for an answer, please wait...", threadID, messageID);

    try {
      let responseData;
      try {
        const imageUrlQuery = await image(args, event, message, global.utils.shortenURL);
        
        const res = await axios.get(`https://barbatosventi3.corpselaugh.repl.co/?id=${senderID}&ask=${response}${ikoQuery}${imageUrlQuery}`);
        responseData = res.data;
      } catch (bardError) {
        if (bardError.response && bardError.response.status === 500) {
          throw new Error("Fallback to the second API");
        } else {
          throw bardError;
        }
      }

      if (
        responseData.error &&
        responseData.error === "No response from Bard AI" ||
        responseData.content.includes("I am still working to learn more languages, so I can't do that just yet.") ||
        responseData.content.includes("I am an LLM trained to") ||
        responseData.content.includes("I am trained to understand and respond only to a subset of languages at this time and can't provide assistance with that") ||
        responseData.content.includes("Bard Help Center.") ||
        responseData.content.includes("I'm a text-based AI") ||
        responseData.content.includes("I'm just a language model, so I can't help you with that.") ||
        responseData.content.includes("I'm not able to help with that") ||
        responseData.content.includes("As a language model,") ||
        responseData.content.includes("I'm unable to help") ||
        responseData.content.includes("the capacity to help with that.") ||
        responseData.content.includes("Please refer to the Bard Help Center for a current list of supported languages.")
      ) {
        throw new Error("Fallback to the second API");
      }

      const { content, links: images } = responseData;

      if (content && content.length > 0) {
        const attachment = [];

        if (!fs.existsSync("cache")) {
          fs.mkdirSync("cache");
        }

        for (let i = 0; i < images.length; i++) {
          const url = images[i];
          const photoPath = `cache/test${i + 1}.png`;

          try {
            const imageResponse = await axios.get(url, { responseType: "arraybuffer" });
            fs.writeFileSync(photoPath, imageResponse.data);

            attachment.push(fs.createReadStream(photoPath));
          } catch (error) {
            console.error("Error occurred while downloading and saving the photo:", error);
          }
        }

        api.sendMessage(
          {
            attachment: attachment,
            body: content,
          },
          threadID,
          messageID
        );
      } else {
        api.sendMessage(content, threadID, messageID);
      }

      requestCounter++;
      storeRequestData();
    } catch (error) {
      if (error.message === "Fallback to the second API") {
        try {
          const res = await axios.get(`https://gptextra.corpselaugh.repl.co/?gpt=${response}${ikoQuery}`);
          const responseData = res.data;

          const { content } = responseData;

          if (content) {
            api.sendMessage(content, threadID, messageID);
          } else {
            api.sendMessage("An error occurred while fetching data from the backup API.", threadID, messageID);
          }

          requestCounter++;
          storeRequestData();
        } catch (backupError) {
          console.error("Error occurred while fetching data from the backup API:", backupError);
          api.sendMessage("An error occurred while searching for an answer.", threadID, messageID);
        }
      } else {
        console.error("Error occurred while fetching data from the Bard API:", error);
        api.sendMessage("An error occurred while searching for an answer.", threadID, messageID);
      }
    }
  },
};

function loadRequestData() {
  if (fs.existsSync(dataFilePath)) {
    const data = fs.readFileSync(dataFilePath, "utf8");
    const jsonData = JSON.parse(data);

    requestCounter = jsonData.request || 0;
    lastResetTime = jsonData.lastResetTime || null;
  } else {
    requestCounter = 0;
    lastResetTime = null;
  }
}

function storeRequestData() {
  const jsonData = {
    request: requestCounter,
    lastResetTime: lastResetTime,
  };

  fs.writeFileSync(dataFilePath, JSON.stringify(jsonData), "utf8");
}

function resetRequestCounter() {
  const currentTime = moment().tz('Asia/Manila');
  if (currentTime.minute() === 0 && (currentTime.second() >= 0 && currentTime.second() <= 30)) {
    requestCounter = 0;
    lastResetTime = currentTime;
    storeRequestData();

    const countdownMessage = "The request limit has been reset. You can now make more requests.";
    console.log(countdownMessage);
  }
}

function loadCoinsData() {
  if (fs.existsSync("coins.json")) {
    const data = fs.readFileSync("coins.json", "utf8");
    return JSON.parse(data);
  } else {
    return [];
  }
}

function getCoinsBySenderID(coinsData, senderID) {
  const userCoinsData = coinsData.find((entry) => entry.senderID === senderID);
  return userCoinsData ? userCoinsData.coins : 0;
}

function deductCoins(coinsData, senderID) {
  const userCoinsData = coinsData.find((entry) => entry.senderID === senderID);
  if (userCoinsData && userCoinsData.coins > 0) {
    userCoinsData.coins--;
  }
}

function storeCoinsData(coinsData) {
  fs.writeFileSync("coins.json", JSON.stringify(coinsData, null, 2), "utf8");
}

async function image(args, event, message, shortenURL) {
  if (event.messageReply && event.messageReply.attachments && event.messageReply.attachments[0] && event.messageReply.attachments[0].url) {
    const imageUrl = await shortenURL(event.messageReply.attachments[0].url);
    return imageUrl ? `&image=${imageUrl}` : '';
  } else {
    return '';
  }
}

async function iko(args, event, message) {
  const messageReply = event.messageReply;
  const body = messageReply ? messageReply.body : '';
  return `\t${body}`;
}
