const {
  ipcMain,
  shell,
  app,
  BrowserWindow,
  dialog,
  Menu,
  Tray,
} = require('electron');
const path = require('path');
const fs = require('fs');
const { TiddlyWiki } = require('tiddlywiki');
const { Conf: Config } = require('electron-conf');
const getPorts = require('get-port').default;
const preload = path.join(__dirname, '../preload/index.js');
const { initI18n, i18next } = require('../i18n');

let config;
let wikiPath;
let mainWindow;
let currentServer = null;
let currentPort = null;
let tray = null;

const iconPath = path.join(__dirname, '..', 'assets', 'tray-icon.png');
const DEFAULT_PORT = 8080;
// 添加显示 Wiki 信息的函数
// 修改 showWikiInfo 函数
async function showWikiInfo() {
  const info = await dialog.showMessageBox({
    type: 'info',
    title: i18next.t('app.about'),
    message: i18next.t('app.name'),
    detail: `${i18next.t('app.currentWikiPath')}：${wikiPath}\n${i18next.t(
      'app.runningPort'
    )}：${currentPort || i18next.t('app.notRunning')}`,
  });
}
// 修改 createTray 函数中的菜单项
// 修改 createTray 函数
function createTray() {
  if (!tray) {
    tray = new Tray(iconPath);
  }
  tray.setToolTip(i18next.t('tray.tooltip'));
  const contextMenu = Menu.buildFromTemplate([
    {
      label: i18next.t('tray.showWindow'),
      click: () => {
        mainWindow.show();
      },
    },
    {
      label: i18next.t('tray.openInBrowser'),
      click: () => {
        if (currentServer && currentPort) {
          shell.openExternal(`http://localhost:${currentPort}`);
        }
      },
    },
    { type: 'separator' },
    {
      label: i18next.t('menu.language'),
      submenu: [
        {
          label: '简体中文',
          type: 'radio',
          checked: i18next.language === 'zh-CN',
          click: () => switchLanguage('zh-CN'),
        },
        {
          label: 'English',
          type: 'radio',
          checked: i18next.language === 'en-US',
          click: () => switchLanguage('en-US'),
        },
      ],
    },
    { type: 'separator' },
    {
      label: i18next.t('tray.about'),
      click: showWikiInfo,
    },
    {
      label: i18next.t('tray.exit'),
      click: () => {
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(contextMenu);
  // 修改点击事件处理，实现窗口切换
  tray.on('click', () => {
    if (mainWindow.isVisible()) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      } else {
        mainWindow.minimize();
      }
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

async function buildWiki() {
  try {
    const { boot } = TiddlyWiki();
    boot.argv = [wikiPath, '--build', 'index'];
    await boot.boot(() => {
      console.log('开始构建');
    });

    const outputPath = path.join(wikiPath, 'output', 'index.html');
    const result = await dialog.showMessageBox({
      type: 'info',
      title: '构建完成',
      message: `Wiki 已构建完成，是否在浏览器中预览？`,
      buttons: ['预览', '在文件夹中显示', '关闭'],
      defaultId: 0,
      cancelId: 2,
    });

    if (result.response === 0) {
      shell.openExternal(`file://${outputPath}`);
    } else if (result.response === 1) {
      shell.showItemInFolder(outputPath);
    }
  } catch (err) {
    dialog.showErrorBox('错误', `构建 Wiki 失败：${err.message}`);
  }
}

async function initWiki(wikiFolder, isFirstTime = false) {
  try {
    if (isFirstTime) {
      const result = await dialog.showOpenDialog({
        title: '选择 Wiki 文件夹位置',
        properties: ['openDirectory'],
        message: '请选择一个文件夹作为 Wiki 的存储位置',
      });

      if (!result.canceled && result.filePaths.length > 0) {
        wikiPath = result.filePaths[0];
        wikiFolder = wikiPath;
        config.set('wikiPath', wikiPath);
      }
    }

    const bootPath = path.join(wikiFolder, 'tiddlywiki.info');

    if (!fs.existsSync(bootPath)) {
      const { boot } = TiddlyWiki();
      boot.argv = [wikiFolder, '--init', 'server'];
      await boot.boot(() => {
        console.log('start init first');
      }); // 首次初始化必须要初始化启动下
      console.log('finished init');
    }

    if (currentServer) {
      currentServer = null;
    }

    // 获取可用端口
    currentPort = await getPorts({ port: DEFAULT_PORT });

    const { boot: twBoot } = TiddlyWiki();
    twBoot.argv = [wikiFolder, '--listen', `port=${currentPort}`];

    const startServer = () => {
      console.log(`start begin: http://localhost:${currentPort}`);
      mainWindow.loadURL(`http://localhost:${currentPort}`);
      mainWindow.webContents.once('did-finish-load', () => {
        // 获取页面标题并设置窗口标题
        const pageTitle = mainWindow.webContents.getTitle();
        mainWindow.setTitle(`${pageTitle} - ${wikiFolder}`);
      });
    };

    currentServer = twBoot;
    twBoot.boot(startServer);
  } catch (err) {
    dialog.showErrorBox('错误', `初始化 Wiki 失败：${err.message}`);
  }
}
async function importSingleFileWiki() {
  try {
    const result = await dialog.showOpenDialog({
      title: '选择 TiddlyWiki HTML 文件',
      filters: [{ name: 'TiddlyWiki HTML', extensions: ['html'] }],
      properties: ['openFile'],
    });

    if (!result.canceled && result.filePaths.length > 0) {
      const htmlPath = result.filePaths[0];
      const targetFolder = await dialog.showOpenDialog({
        title: '选择导入目标文件夹',
        properties: ['openDirectory'],
        message: '请选择要将 Wiki 导入到的目标文件夹',
      });

      if (!targetFolder.canceled && targetFolder.filePaths.length > 0) {
        const targetPath = targetFolder.filePaths[0];

        const { boot } = TiddlyWiki();
        boot.argv = ['--load', htmlPath, '--savewikifolder', targetPath];
        await boot.boot(() => {
          console.log('开始导入单文件 Wiki');
        });

        // 更新当前 Wiki 路径并重新初始化
        wikiPath = targetPath;
        config.set('wikiPath', wikiPath);
        await initWiki(wikiPath);

        dialog.showMessageBox({
          type: 'info',
          title: '导入成功',
          message: '单文件 Wiki 已成功导入到 Node.js 版本',
        });
      }
    }
  } catch (err) {
    dialog.showErrorBox('错误', `导入失败：${err.message}`);
  }
}
// 修改切换语言的函数
async function switchLanguage(lang) {
  config.set('language', lang);
  await i18next.changeLanguage(lang);

  // 更新菜单
  const menu = Menu.buildFromTemplate(createMenuTemplate());
  Menu.setApplicationMenu(menu);

  // 更新托盘菜单
  createTray();

  // 显示语言切换成功提示
  dialog.showMessageBox({
    type: 'info',
    title: i18next.t('settings.languageChanged'),
    message: i18next.t('settings.restartTips'),
  });
}

// 添加创建菜单模板的函数
function createMenuTemplate() {
  return [
    {
      label: i18next.t('menu.file'),
      submenu: [
        {
          label: '打开 Wiki',
          click: openFolderDialog,
        },
        {
          label: '导入单文件 Wiki',
          click: importSingleFileWiki,
        },
        {
          label: '构建 Wiki',
          click: buildWiki,
        },
        {
          label: '在浏览器中打开 TiddlyWiki',
          click: () => {
            if (currentServer && currentPort) {
              shell.openExternal(`http://localhost:${currentPort}`);
            }
          },
        },
        {
          label: '打开当前 Wiki 文件夹',
          click: () => {
            if (wikiPath) {
              shell.showItemInFolder(wikiPath);
            }
          },
        },
        { type: 'separator' },
        {
          label: '退出',
          role: 'quit',
        },
      ],
    },
    {
      label: i18next.t('menu.settings'),
      submenu: [
        {
          label: i18next.t('menu.language'),
          submenu: [
            {
              label: '简体中文',
              type: 'radio',
              checked: i18next.language === 'zh-CN',
              click: () => switchLanguage('zh-CN'),
            },
            {
              label: 'English',
              type: 'radio',
              checked: i18next.language === 'en-US',
              click: () => switchLanguage('en-US'),
            },
          ],
        },
      ],
    },
    {
      label: i18next.t('menu.help'),
      submenu: [
        {
          label: '打开开发者工具',
          click: () => mainWindow.webContents.openDevTools({ mode: 'right' }),
        },
        {
          label: '关于',
          click: showWikiInfo,
        },
      ],
    },
  ];
}

// 修改 createWindow 函数中的菜单创建部分
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 800,
    icon: iconPath,
    // frame: false,
    // titleBarStyle: 'hidden',
    // titleBarOverlay: {
    //   color: 'transparent',
    //   symbolColor: 'transparent',
    //   height: 10,
    // },
    webPreferences: {
      preload,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
    },
  });
  // 创建任务栏图标
  createTray();

  // 处理窗口最小化事件
  mainWindow.on('minimize', (event) => {
    event.preventDefault();
    mainWindow.hide();
  });

  // 处理窗口关闭按钮事件
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      return false;
    }
    return true;
  });
  // 检查是否首次启动
  const isFirstTime = !config.get('wikiPath');

  // 初始化并加载 wiki
  initWiki(wikiPath, isFirstTime);
  // 注入渲染脚本
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.executeJavaScript(`
      const script = document.createElement('script');
      script.src = 'file://${path
        .join(__dirname, '..', 'renderer', 'render.js')
        .replace(/\\/g, '/')}';
      document.body.appendChild(script);
    `);
  });
  const menu = Menu.buildFromTemplate(createMenuTemplate());
  Menu.setApplicationMenu(menu);
}
// 添加 openFolderDialog 函数定义
async function openFolderDialog() {
  const result = await dialog.showOpenDialog({
    title: '选择 Wiki 文件夹',
    properties: ['openDirectory'],
  });

  if (!result.canceled && result.filePaths.length > 0) {
    if (wikiPath === result.filePaths[0]) {
      console.info('已经是当前打开的 Wiki 文件夹');
      return;
    }
    wikiPath = result.filePaths[0];
    config.set('wikiPath', wikiPath);
    await initWiki(wikiPath);
  }
}

// 添加 IPC 处理程序
ipcMain.handle('dialog:openWiki', openFolderDialog);
ipcMain.handle('wiki:build', buildWiki);
ipcMain.handle('wiki:openInBrowser', () => {
  if (currentServer && currentPort) {
    shell.openExternal(`http://localhost:${currentPort}`);
  }
});
ipcMain.handle('wiki:getInfo', () => {
  return {
    wikiPath,
    port: currentPort,
  };
});

// 修改 initApp 函数
const initApp = async () => {
  config = new Config({
    defaults: {
      wikiPath: path.resolve('wiki'),
      language: 'zh-CN',
    },
  });
  // 初始化 wikiPath
  wikiPath = config.get('wikiPath');
  // 初始化 i18n，传入 config
  await initI18n(config);
  // 启动应用
  app.whenReady().then(createWindow);
};

// 将原来的立即执行函数替换为初始化调用
initApp();

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.isQuitting = true;
    app.quit();
  }
});

// 添加 before-quit 事件处理
app.on('before-quit', () => {
  app.isQuitting = true;
});
