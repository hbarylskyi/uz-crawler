const puppeteer = require("puppeteer");
const { execFile } = require("child_process");
const parseArgs = require("minimist");

// const userAgent = 'Mozilla/5.0 (Linux; Android 7.0; SM-G930V Build/NRD90M) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/59.0.3071.125 Mobile Safari/537.36';
const loadTimeout = 120000;
const height = 700;
const width = 500;
const waitingBeforeRetryTime = 50;
const ignoredTrains = ["749 Л"];

let iterationIndex = 0;
const args = parseArgs(process.argv);
const { url, stopOnError } = args;

if (!url.includes("booking.uz.gov.ua")) {
  console.log("Invalid url");
  return;
}

(async () => {
  // launch browser
  const browser = await puppeteer.launch({
    headless:false,
    args: [
        `--window-size=${ width },${ height + 150 }`
    ]
  });
  const page = await browser.newPage();
  await page.setViewport({ height, width });
  await page.goto(url, { timeout: loadTimeout });

  function notifyViaEmail() {
    execFile("./sendEmail.sh");
  }

  async function waitForPreloader() {
    const preloader = await page.$(".popup-preloader");

    if (preloader) {
      console.log("waiting for preloader");

      try {
        await page.waitForFunction(
            () => !document.querySelector(".popup-preloader")
        );
      }
      catch (e) {
        console.error('Preloader does not seem to disappear');
      }
    }
  }

  async function sleep(time = waitingBeforeRetryTime) {
    await new Promise(resolve => setTimeout(resolve, time));
  }

  async function parseTrains(trainRows) {
    // remove rows with trains which should be ignored
    const trainNames = [];

    for (trainRow of trainRows) {
      const trainNum = await trainRow.$(".num");
      const trainNumTextContent = await page.evaluate(
        element => element.textContent,
        trainNum
      );

      const trainName = trainNumTextContent.replace("Маршрут", "");

      const isIgnored = ignoredTrains.some(ignored =>
        trainName.includes(ignored)
      );

      if (!isIgnored) trainNames.push(trainName);
    }

    if (trainNames.length) {
      console.log(`I've found ${trainNames.length} entries`);
      console.log(url);
      execFile("./foundNotification.sh");
      notifyViaEmail();

      await page.screenshot({ path: `found/${Date.now()}.png` });
      return true;
    }
  }

  async function clickSelect() {
    try {
      await page.click('input[value="Choose"]');

      await waitForPreloader();

      const popup = await page.$('.popup-canvas.popup-alert');
      if (popup) return false;

      await page.click('div.place.fr');
      await page.click('.next-button input');

      await waitForPreloader();

      await page.type('input[name="lastname"]', 'Барильський');
      await page.type('input[name="firstname"]', 'Глеб');

      const nextBtns = await page.$$(".next-button input");
      await page.evaluate(element => element.click(), nextBtns[1]);

      return true;
    }
    catch (e) {
      console.error(e);
    }
  }

  while (true) {
    try {
      iterationIndex += 1;
      console.log(iterationIndex);

      if (iterationIndex%1800 === 0) {
        console.log(new Date().toString());
      }

      await waitForPreloader();

      const trainRows = await page.$$("#train-list tr:not(.no-place)");
      // remove first row which is labels row
      trainRows.shift();

      if (trainRows.length) {
        const didFind = await parseTrains(trainRows);

        if (didFind) {
          const booked = await clickSelect();

          if (booked) {
            break;
          }
        }
      }
      // else {
      //   const searchEmptyMessage = await page.$(".search-error");
      //
      //   if (!searchEmptyMessage) throw Error("No 'search is empty' message");
      // }

      await sleep();
      // await page.reload({ timeout: loadTimeout });
    } catch (e) {
      execFile("./errorNotification.sh");
      console.log("WHAT THE FUCK!");
      console.error(e);

      await page.screenshot({ path: "lastError.png" });

      await sleep(3000);

      if (stopOnError) {
        await browser.close();
        break;
      }
    }
  }
})();
