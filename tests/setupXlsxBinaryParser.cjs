const superagent = require("superagent");

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

superagent.parse[XLSX_MIME] = (response, callback) => {
  const chunks = [];

  response.on("data", (chunk) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });
  response.on("end", () => callback(null, Buffer.concat(chunks)));
  response.on("error", (error) => callback(error));
};
