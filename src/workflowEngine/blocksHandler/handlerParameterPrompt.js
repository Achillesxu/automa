import { nanoid } from 'nanoid/non-secure';
import browser from 'webextension-polyfill';
import { sleep } from '@/utils/helper';
import renderString from '../templating/renderString';

function getInputtedParams(promptId, ms = 10000) {
  return new Promise((resolve, reject) => {
    const timeout = null;

    const storageListener = (event) => {
      if (!event[promptId]) return;

      clearTimeout(timeout);
      browser.storage.onChanged.removeListener(storageListener);
      browser.storage.local.remove(promptId);

      const { newValue } = event[promptId];
      if (newValue.$isError) {
        reject(new Error(newValue.message));
        return;
      }

      resolve(newValue);
    };

    if (ms > 0) {
      setTimeout(() => {
        browser.storage.onChanged.removeListener(storageListener);
        resolve({});
      }, ms);
    }

    browser.storage.onChanged.addListener(storageListener);
  });
}

async function renderParamValue(param, refData, isPopup) {
  const renderedVals = {};

  const keys = ['defaultValue', 'description', 'placeholder'];
  await Promise.allSettled(
    keys.map(async (key) => {
      if (!param[key]) return;
      renderedVals[key] = (
        await renderString(param[key], refData, isPopup)
      ).value;
    })
  );

  return { ...param, ...renderedVals };
}

export default async function ({ data, id }, { refData }) {
  const paramURL = browser.runtime.getURL('/params.html');
  let tab = (await browser.tabs.query({})).find((item) =>
    item.url.includes(paramURL)
  );

  if (!tab) {
    const { tabs } = await browser.windows.create({
      type: 'popup',
      width: 480,
      height: 600,
      url: browser.runtime.getURL('/params.html'),
    });
    [tab] = tabs;
    await sleep(1000);
  } else {
    await browser.tabs.update(tab.id, {
      active: true,
    });
    await browser.windows.update(tab.windowId, { focused: true });
  }

  const promptId = `params-prompt:${nanoid(4)}__${id}`;
  const { timeout } = data;

  const params = await Promise.all(
    data.parameters.map((item) =>
      renderParamValue(item, refData, this.engine.isPopup)
    )
  );

  await browser.tabs.sendMessage(tab.id, {
    name: 'workflow:params-block',
    data: {
      params,
      promptId,
      blockId: id,
      timeoutMs: timeout,
      execId: this.engine.id,
      timeout: Date.now() + timeout,
      name: this.engine.workflow.name,
      icon: this.engine.workflow.icon,
      description: this.engine.workflow.description,
    },
  });

  const result = await getInputtedParams(promptId, timeout);

  await Promise.allSettled(
    Object.entries(result).map(async ([varName, varValue]) =>
      this.setVariable(varName, varValue)
    )
  );

  return {
    data: '',
    nextBlockId: this.getBlockConnections(id),
  };
}
