const express = require("express");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("KDM Download Proxy Active. Please provide a 'vid' parameter.");
});

app.get("/proxy", async (req, res) => {
  const targetUrl = req.query.vid;

  if (!targetUrl) {
    return res.status(400).send("Error: No video URL provided");
  }

  try {
    // 1. Prepare identity-spoofing and incoming request headers
    const forwardHeaders = {
      Accept: "*/*",
      "Accept-Language": "en-US,en;q=0.8",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      Priority: "u=1, i",
      "Sec-CH-UA": '"Chromium";v="148", "Brave";v="148", "Not/A)Brand";v="99"',
      "Sec-CH-UA-Mobile": "?1",
      "Sec-CH-UA-Platform": '"Android"',
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "cross-site",
      "Sec-GPC": "1",
      // Identity masking strings
      Origin: "https://kwik.cx",
      Referer: "https://kwik.cx/",
      "User-Agent": "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36",
    };

    // Forward Range header from download managers to enable pausing/resuming
    if (req.headers.range) {
      forwardHeaders["Range"] = req.headers.range;
    }

    // 2. Fetch the video chunk stream from the source server
    const response = await axios({
      url: targetUrl,
      method: "GET",
      responseType: "stream",
      maxRedirects: 10,
      headers: forwardHeaders,
    });

    // 3. Set up loose CORS controls so browsers and client engines can access the stream
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Headers", "Range, Content-Type");

    // 4. Mirror all source headers down to the user (excluding session management elements)
    for (const [key, value] of Object.entries(response.headers)) {
      const lowerKey = key.toLowerCase();
      if (lowerKey !== "set-cookie" && lowerKey !== "content-encoding") {
        res.setHeader(key, value);
      }
    }

    // 5. Extract filename from headers or fall back to query params/URL structure
    let contentDisposition = response.headers['content-disposition'];

    if (!contentDisposition) {
      try {
        const parsedUrl = new URL(targetUrl);
        // Look inside queries first (for patterns like ?file=...)
        let filenameFromUrl = parsedUrl.searchParams.get("file");

        // Fall back to the end of the directory path string
        if (!filenameFromUrl) {
          const urlPath = parsedUrl.pathname;
          filenameFromUrl = urlPath.substring(urlPath.lastIndexOf('/') + 1);
        }

        // Clean out URL components (%5B to [, etc.) and assign attachment rules
        if (filenameFromUrl && filenameFromUrl.includes('.')) {
          const decodedFilename = decodeURIComponent(filenameFromUrl);
          contentDisposition = `attachment; filename="${decodedFilename}"`;
        } else {
          contentDisposition = 'attachment; filename="video.mp4"';
        }
      } catch (e) {
        contentDisposition = 'attachment; filename="video.mp4"';
      }
    }

    // Bind filename attachment instruction
    res.setHeader("Content-Disposition", contentDisposition);

    // Explicitly send back the server status (essential for 206 Partial Content streams)
    res.status(response.status);

    // 6. Direct line pipe of data slices directly to the download stream
    response.data.pipe(res);

  } catch (error) {
    const status = error.response?.status || 500;
    
    // Ensure error states don't cause crashes if headers were already sent mid-stream
    if (!res.headersSent) {
      res.status(status).send(
        error.response?.data || error.message || "Internal Server Error"
      );
    }
  }
});

app.listen(PORT, () => {
  console.log(`Proxy server successfully initialized on port ${PORT}`);
});