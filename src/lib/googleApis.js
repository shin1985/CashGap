function loadScript(src, id) {
  return new Promise((resolve, reject) => {
    const existing = document.getElementById(id);
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error(`Failed to load script: ${src}`)), {
        once: true,
      });
      if (existing.dataset.loaded === "true") {
        resolve();
      }
      return;
    }

    const script = document.createElement("script");
    script.id = id;
    script.async = true;
    script.defer = true;
    script.src = src;
    script.onload = () => {
      script.dataset.loaded = "true";
      resolve();
    };
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(script);
  });
}

let googleReadyPromise;

export async function ensureGoogleApis() {
  if (!googleReadyPromise) {
    googleReadyPromise = (async () => {
      await Promise.all([
        loadScript("https://accounts.google.com/gsi/client", "cashgap-gis"),
        loadScript("https://apis.google.com/js/api.js", "cashgap-gapi"),
      ]);

      await new Promise((resolve, reject) => {
        const startedAt = Date.now();
        const waitForGlobals = () => {
          if (window.google?.accounts?.oauth2 && window.gapi?.load) {
            window.gapi.load("picker", {
              callback: resolve,
              onerror: () => reject(new Error("Google Picker failed to load.")),
            });
            return;
          }

          if (Date.now() - startedAt > 15000) {
            reject(new Error("Google API script initialization timed out."));
            return;
          }

          window.setTimeout(waitForGlobals, 50);
        };

        waitForGlobals();
      });
    })();
  }

  return googleReadyPromise;
}

export async function requestAccessToken({ clientId, scope }) {
  await ensureGoogleApis();

  return new Promise((resolve, reject) => {
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope,
      callback: (response) => {
        if (!response || response.error) {
          reject(new Error(response?.error_description || response?.error || "Google authorization failed."));
          return;
        }
        resolve(response.access_token);
      },
    });

    tokenClient.requestAccessToken({ prompt: "consent" });
  });
}

export async function fetchGoogleUser(accessToken) {
  const response = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error("Failed to fetch Google account profile.");
  }

  return response.json();
}

function createPickerView({ mode = "files", parentId }) {
  const picker = window.google.picker;
  const viewId = mode === "folders" ? picker.ViewId.FOLDERS : picker.ViewId.DOCS;
  const view = new picker.DocsView(viewId)
    .setIncludeFolders(mode === "folders")
    .setEnableDrives(true)
    .setOwnedByMe(false);

  if (mode === "folders") {
    view.setSelectFolderEnabled(true);
  }

  if (parentId) {
    view.setParent(parentId);
  }

  return view;
}

function normalizePickedDocument(doc) {
  const picker = window.google.picker;
  return {
    id: doc.id || doc[picker.Document.ID],
    name: doc.name || doc[picker.Document.NAME] || "Untitled",
    mimeType: doc.mimeType || doc[picker.Document.MIME_TYPE] || "",
    url: doc.url || doc[picker.Document.URL] || "",
  };
}

function openPicker({ apiKey, appId, accessToken, title, selectableMimeTypes, parentId, mode = "files" }) {
  return new Promise((resolve, reject) => {
    const picker = window.google.picker;
    const view = createPickerView({ mode, parentId });

    const builder = new picker.PickerBuilder()
      .setDeveloperKey(apiKey)
      .setAppId(String(appId))
      .setOAuthToken(accessToken)
      .setOrigin(window.location.origin)
      .setTitle(title)
      .addView(view)
      .setSelectableMimeTypes(selectableMimeTypes)
      .setCallback((data) => {
        if (data.action === picker.Action.PICKED) {
          resolve(normalizePickedDocument(data.docs[0]));
          return;
        }

        if (data.action === picker.Action.CANCEL) {
          resolve(null);
        }
      });

    try {
      const instance = builder.build();
      instance.setVisible(true);
    } catch (error) {
      reject(error);
    }
  });
}

export async function pickDriveFolder({ apiKey, appId, accessToken }) {
  await ensureGoogleApis();
  return openPicker({
    apiKey,
    appId,
    accessToken,
    title: "Choose a shared drive folder for CashGap",
    selectableMimeTypes: "application/vnd.google-apps.folder",
    mode: "folders",
  });
}

export async function pickSpreadsheet({ apiKey, appId, accessToken, parentId }) {
  await ensureGoogleApis();
  return openPicker({
    apiKey,
    appId,
    accessToken,
    parentId,
    title: "Choose a CashGap spreadsheet",
    selectableMimeTypes: "application/vnd.google-apps.spreadsheet",
    mode: "files",
  });
}

async function googleRequest(url, accessToken, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    let message = `Google API request failed (${response.status}).`;
    try {
      const payload = await response.json();
      message = payload?.error?.message || message;
    } catch (_error) {
      // ignore JSON parse errors and surface the default message.
    }
    throw new Error(message);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

export async function createSpreadsheetInFolder({ accessToken, folderId, title }) {
  return googleRequest(
    "https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id,name,webViewLink",
    accessToken,
    {
      method: "POST",
      body: JSON.stringify({
        name: title,
        mimeType: "application/vnd.google-apps.spreadsheet",
        parents: [folderId],
        appProperties: {
          app: "cashgap",
          schemaVersion: "1",
        },
      }),
    },
  );
}
