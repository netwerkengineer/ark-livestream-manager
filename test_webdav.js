const { createClient } = require("webdav");
const fs = require("fs");
const settings = require("./data/settings.json");

const client = createClient(settings.webdavUrl, {
  username: settings.webdavUser,
  password: settings.webdavPass,
});

async function run() {
  try {
    const content = Buffer.from("test");
    await client.putFileContents("/test_upload.txt", content);
    console.log("Upload successful!");
  } catch (e) {
    console.error("Error:", e.message);
    if (e.response) {
      console.error("Response:", e.response.status, e.response.statusText);
    }
  }
}
run();
