import { app, BrowserWindow, nativeImage } from 'electron'
import path from 'path'
import fs from 'fs'
import { isDev, getCurrentDir } from './config'
import { logger } from './logger'

let mainWindow: BrowserWindow | null = null

export function createWindow(): BrowserWindow {
  const preloadPath = isDev
    ? path.join(getCurrentDir(), 'dist-electron', 'preload.js')
    : path.join(app.getAppPath(), 'dist-electron', 'preload.js')

  const iconExt =
    process.platform === 'win32'
      ? 'icon.ico'
      : 'icon.png'

  const iconPath = path.join(
    getCurrentDir(),
    'resources',
    iconExt
  )

  logger.info(
    `[icon] Loading app icon from: ${iconPath} | exists: ${fs.existsSync(iconPath)}`
  )

  const appIcon = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath)
    : undefined

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    title: 'LARA Anime Forge',
    icon: appIcon,
    backgroundColor: '#1a1a1a',
    titleBarStyle: 'default',
    show: false,

    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: !isDev
    }
  })

  if (isDev) {
    void mainWindow.loadURL(
      'http://localhost:5173'
    )
  } else {
    void mainWindow.loadFile(
      path.join(
        app.getAppPath(),
        'dist',
        'index.html'
      )
    )
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  return mainWindow
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}
