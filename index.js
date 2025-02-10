import axios from "axios";
import readline from "readline";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const JSON_FILE = "payloads.json";

async function getWalletAddress() {
  const wallets = Object.keys(process.env)
    .filter((key) => key.startsWith("WALLET_ADDRESS_"))
    .map((key) => ({ key, address: process.env[key] }));

  if (wallets.length > 0) {
    console.log("Available Wallets:");
    wallets.forEach(({ address }, index) => {
      console.log(`${index + 1}. ${address.slice(0, 6)}...${address.slice(-4)}`);
    });
    console.log("0. Add new wallet");

    return new Promise((resolve) => {
      rl.question("Select a wallet or add new (0): ", (choice) => {
        const selectedIndex = parseInt(choice, 10);
        if (selectedIndex > 0 && selectedIndex <= wallets.length) {
          resolve(wallets[selectedIndex - 1].address);
        } else {
          rl.question("Enter new wallet address: ", (walletAddress) => {
            const newKey = `WALLET_ADDRESS_${wallets.length + 1}`;
            fs.appendFileSync(".env", `\n${newKey}=${walletAddress}`);
            resolve(walletAddress);
          });
        }
      });
    });
  } else {
    return new Promise((resolve) => {
      rl.question("Enter your wallet address: ", (walletAddress) => {
        fs.appendFileSync(".env", `\nWALLET_ADDRESS_1=${walletAddress}`);
        resolve(walletAddress);
      });
    });
  }
}

async function sendRequest(walletAddress, message) {
  try {
    const payloadMain = {
      wallet_address: walletAddress,
      message,
      stream: true,
    };

    process.stdout.write(`[Question] ${message} `);

    const response = await axios.post(
      "https://deployment-hlsy5tjcguvea2aqgplixjjg.stag-vxzy.zettablock.com/main",
      payloadMain,
      {
        headers: { "Content-Type": "application/json" },
        responseType: "stream",
      }
    );

    let collectedData = "";
    response.data.on("data", (chunk) => {
      const jsonStr = chunk.toString().trim();
      const jsonLines = jsonStr.split("\n");
      jsonLines.forEach((line) => {
        if (line.startsWith("data: ")) {
          const jsonData = line.replace("data: ", "").trim();
          if (jsonData === "[DONE]") return;
          try {
            const parsed = JSON.parse(jsonData);
            if (parsed.choices?.[0]?.delta?.content) {
              collectedData += parsed.choices[0].delta.content;
            }
          } catch (err) {
            console.error("Error parsing response chunk:", err.message);
          }
        }
      });
    });

    await new Promise((resolve) => response.data.on("end", resolve));

    const payloadReport = {
      wallet_address: walletAddress,
      agent_id: "deployment_HlsY5TJcguvEA2aqgPliXJjg",
      request_text: message,
      response_text: collectedData,
      request_metadata: { source: "api_test" },
    };

    const reportResponse = await axios.post(
      "https://quests-usage-dev.prod.zettablock.com/api/report_usage",
      payloadReport,
      { headers: { "Content-Type": "application/json" } }
    );
    process.stdout.write(`[Report Usage] ${reportResponse.data.message} `);

    const interactionId = reportResponse.data.interaction_id;
    if (!interactionId) throw new Error("interaction_id not found");

    let status = "pending", txHash = "";
    while (status === "pending" || !txHash) {
      await new Promise((r) => setTimeout(r, 2000));
      const inferenceResponse = await axios.get(
        `https://neo-dev.prod.zettablock.com/v1/inference?id=${interactionId}`,
        {
          headers: {
            "Accept": "*/*",
            "Origin": "https://agents.testnet.gokite.ai",
            "Referer": "https://agents.testnet.gokite.ai/",
            "User-Agent": "Mozilla/5.0",
          },
        }
      );
      status = inferenceResponse.data.data.status;
      txHash = inferenceResponse.data.data.tx_hash;
    }

    console.log(`[Inference] Status: ${status}, TxHash: ${txHash}`);
  } catch (error) {
    if (error.response?.status === 429 || error.response?.data?.error?.includes("Rate limit")) {
      console.error("Skipping due to rate limit...");
      return;
    }
    console.error("Error:", error.response?.data || error.message);
  }
}

async function main() {
  const walletAddress = await getWalletAddress();
  const payloads = JSON.parse(fs.readFileSync(JSON_FILE, "utf8"));

  for (const message of payloads) {
    await sendRequest(walletAddress, message);
    console.log("\n");
  }

  rl.close(); // Pastikan readline ditutup
  process.exit(0); // Paksa keluar program setelah semua selesai
}

main();
