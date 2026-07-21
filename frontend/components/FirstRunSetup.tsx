import { useState, useEffect, useRef, useCallback } from 'react'
import { ApiClient, type ApiRequestBodyOf, type ApiSuccessOf } from '../lib/api-client'
import { logger } from '../lib/logger'
import { useHfAuth } from '../hooks/use-hf-auth'
import { useHfModelAccess } from '../hooks/use-hf-model-access'
import { useAppSettings } from '../contexts/AppSettingsContext'
import './FirstRunSetup.css'
import { LtxLogo } from './LtxLogo'

interface LaunchGateProps {
  licenseOnly?: boolean
  showLicenseStep?: boolean
  onComplete: () => Promise<void>
  onAcceptLicense?: () => Promise<void>
}

type Step = 'license' | 'location' | 'installing' | 'complete'
type StartModelDownloadBody = NonNullable<ApiRequestBodyOf<'startModelDownload'>>
type ModelCheckpointID = NonNullable<StartModelDownloadBody['cp_ids']>[number]
type LtxRecommendation = ApiSuccessOf<'getLtxRecommendation'>
type ImgGenRecommendation = ApiSuccessOf<'getImgGenRecommendation'>
type DownloadProgress = ApiSuccessOf<'getModelDownloadProgress'>
type DownloadStepSpec = {
  type: StartModelDownloadBody['type']
  cpIds: ModelCheckpointID[]
}

// Fun loading messages
const INSTALL_MESSAGES = [
  "Pobieranie wag modeli...",
  "Uczenie AI, jak śnić w 4K...",
  "Ładowanie ścieżek neuronowych...",
  "Kalibrowanie silnika generowania...",
  "Już prawie gotowe...",
  "Rozpakowywanie magii...",
  "Konfigurowanie parametrów...",
  "Kończenie instalacji..."
]

function uniqueCpIds(cpIds: readonly ModelCheckpointID[]): ModelCheckpointID[] {
  return [...new Set(cpIds)]
}

function buildAccessCheckpointIds(
  ltxRecommendation: LtxRecommendation | null,
  imgGenRecommendation: ImgGenRecommendation | null,
): ModelCheckpointID[] {
  if (!ltxRecommendation || !imgGenRecommendation) return []

  const cpIds: ModelCheckpointID[] = []
  if (ltxRecommendation.status === 'download') {
    cpIds.push(...ltxRecommendation.cps_to_download)
  }
  if (imgGenRecommendation.cp_to_download) {
    cpIds.push(imgGenRecommendation.cp_to_download)
  }
  return uniqueCpIds(cpIds)
}

function buildDownloadSteps(
  ltxRecommendation: LtxRecommendation,
  imgGenRecommendation: ImgGenRecommendation,
): DownloadStepSpec[] {
  const cpIds: ModelCheckpointID[] = []
  if (ltxRecommendation.status === 'download') {
    cpIds.push(...ltxRecommendation.cps_to_download)
  }
  if (imgGenRecommendation.cp_to_download) {
    cpIds.push(imgGenRecommendation.cp_to_download)
  }
  const unique = uniqueCpIds(cpIds)
  return unique.length > 0 ? [{ type: 'download', cpIds: unique }] : []
}


export function LaunchGate({
  licenseOnly,
  showLicenseStep = true,
  onComplete,
  onAcceptLicense,
}: LaunchGateProps) {
  const [currentStep, setCurrentStep] = useState<Step>(showLicenseStep ? 'license' : 'location')
  const [installPath, setInstallPath] = useState('')
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [downloadSessionId, setDownloadSessionId] = useState<string | null>(null)
  const [installMessage, setInstallMessage] = useState(INSTALL_MESSAGES[0])
  const [availableSpace, setAvailableSpace] = useState('...')
  const [videoPath, setVideoPath] = useState('/splash/splash.mp4')
  const [ltxApiKey, setLtxApiKey] = useState('')
  const [licenseAccepted, setLicenseAccepted] = useState(false)
  const [licenseText, setLicenseText] = useState<string | null>(null)
  const [licenseError, setLicenseError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [isActionPending, setIsActionPending] = useState(false)
  const [requiredCheckpointIds, setRequiredCheckpointIds] = useState<ModelCheckpointID[]>([])
  const { hfAuthStatus, hfAuthPolling, startHuggingFaceLogin } = useHfAuth(currentStep === 'location')
  const { accessMap, allAuthorized } = useHfModelAccess(requiredCheckpointIds, hfAuthStatus)
  const { saveLtxApiKey } = useAppSettings()
  const modelAccessRef = useRef<HTMLDivElement>(null)
  const downloadQueueRef = useRef<DownloadStepSpec[]>([])
  const runningDownloadProgress = downloadProgress?.status === 'downloading' ? downloadProgress : null
  const totalProgress = runningDownloadProgress?.total_progress ?? (downloadProgress?.status === 'complete' ? 100 : 0)

  // Format bytes to human readable
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
  }

  // Format time remaining
  const formatTimeRemaining = (seconds: number): string => {
    if (!seconds || !isFinite(seconds) || seconds <= 0) return '--'
    if (seconds < 60) return `${Math.round(seconds)}s`
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`
    return `${Math.round(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`
  }

  // Calculate ETA based on speed and remaining bytes
  const getTimeRemaining = (): string => {
    if (!runningDownloadProgress || runningDownloadProgress.speed_bytes_per_sec <= 0) return '--'
    const remainingBytes = runningDownloadProgress.expected_total_bytes - runningDownloadProgress.total_downloaded_bytes
    if (remainingBytes <= 0) return '--'
    const secondsRemaining = remainingBytes / runningDownloadProgress.speed_bytes_per_sec
    return formatTimeRemaining(secondsRemaining)
  }

  // Fetch license text
  const fetchLicense = async () => {
    setLicenseError(null)
    setLicenseText(null)
    try {
      const text = await window.electronAPI.fetchLicenseText()
      setLicenseText(text)
    } catch (e) {
      setLicenseError(e instanceof Error ? e.message : 'Nie udało się wczytać treści licencji.')
    }
  }

  const refreshModelRecommendations = useCallback(async () => {
    if (licenseOnly) return

    const [settingsResult, ltxResult, imgGenResult] = await Promise.all([
      ApiClient.getSettings(),
      ApiClient.getLtxRecommendation(),
      ApiClient.getImgGenRecommendation(),
    ])
    if (!settingsResult.ok) {
      logger.error(`Failed to fetch model recommendations: ${settingsResult.error.message}`)
      return
    }
    if (!ltxResult.ok) {
      logger.error(`Failed to fetch model recommendations: ${ltxResult.error.message}`)
      return
    }
    if (!imgGenResult.ok) {
      logger.error(`Failed to fetch model recommendations: ${imgGenResult.error.message}`)
      return
    }

    setInstallPath(settingsResult.data.modelsDir ?? '')
    setRequiredCheckpointIds(buildAccessCheckpointIds(ltxResult.data, imgGenResult.data))
  }, [licenseOnly])

  const startDownloadStep = useCallback(async (step: DownloadStepSpec) => {
    setDownloadProgress(null)
    setDownloadError(null)
    const result = await ApiClient.startModelDownload({
      type: step.type,
      cp_ids: step.cpIds,
    })
    if (!result.ok) {
      throw new Error(result.error.message)
    }
    const downloadData = result.data
    if (downloadData.status === 'started') {
      setDownloadSessionId(downloadData.sessionId)
      return
    }
    throw new Error('Otrzymano nieoczekiwaną odpowiedź podczas rozpoczynania pobierania modelu.')
  }, [])

  // Initialize
  useEffect(() => {
    const init = async () => {
      try {
        // Get video path for production (unpacked from asar)
        try {
          const resourcePath = await window.electronAPI.getResourcePath?.()
          if (resourcePath) {
            setVideoPath(`file://${resourcePath}/app.asar.unpacked/dist/splash/splash.mp4`)
          }
        } catch {
          // Dev mode: use relative path
          setVideoPath('/splash/splash.mp4')
        }

        await refreshModelRecommendations()

        // TODO: Get actual available space
        setAvailableSpace('1.8 TB')
      } catch (e) {
        logger.error(`Init error: ${e}`)
      }
    }
    init()
    if (showLicenseStep) {
      void fetchLicense()
    }
  }, [refreshModelRecommendations, showLicenseStep])

  // Auto-scroll to model access section when it appears
  useEffect(() => {
    if (hfAuthStatus === 'authenticated' && Object.keys(accessMap).length > 0 && !allAuthorized) {
      modelAccessRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [hfAuthStatus, accessMap, allAuthorized])

  // Cycle install messages
  useEffect(() => {
    if (currentStep !== 'installing') return
    let index = 0
    const interval = setInterval(() => {
      index = (index + 1) % INSTALL_MESSAGES.length
      setInstallMessage(INSTALL_MESSAGES[index])
    }, 4000)
    return () => clearInterval(interval)
  }, [currentStep])

  // Poll download progress during installation
  useEffect(() => {
    if (currentStep !== 'installing' || !downloadSessionId) return

    const pollProgress = async () => {
      const result = await ApiClient.getModelDownloadProgress({ sessionId: downloadSessionId })
      if (!result.ok) {
        logger.error(`Progress poll error: ${result.error.message}`)
        return
      }

      const progress = result.data
      setDownloadProgress(progress)

      if (progress.status === 'error') {
        downloadQueueRef.current = []
        setDownloadError(progress.error || 'Pobieranie nie powiodło się.')
      } else if (progress.status === 'complete') {
        const nextStep = downloadQueueRef.current.shift() ?? null
        if (nextStep) {
          await startDownloadStep(nextStep)
          return
        }
        setTimeout(() => setCurrentStep('complete'), 600)
      }
    }

    pollProgress()
    const interval = setInterval(pollProgress, 500)
    return () => clearInterval(interval)
  }, [currentStep, downloadSessionId, startDownloadStep])

  // Start installation
  const startInstallation = async () => {
    setCurrentStep('installing')
    try {
      if (ltxApiKey.trim()) {
        try {
          await saveLtxApiKey(ltxApiKey.trim())
        } catch (e) {
          logger.error(`Failed to save API key: ${e instanceof Error ? e.message : String(e)}`)
        }
      }

      const [ltxResult, imgGenResult] = await Promise.all([
        ApiClient.getLtxRecommendation(),
        ApiClient.getImgGenRecommendation(),
      ])
      if (!ltxResult.ok) {
        throw new Error(ltxResult.error.message)
      }
      if (!imgGenResult.ok) {
        throw new Error(imgGenResult.error.message)
      }
      const nextLtxRecommendation = ltxResult.data
      const nextImgGenRecommendation = imgGenResult.data
      setRequiredCheckpointIds(buildAccessCheckpointIds(nextLtxRecommendation, nextImgGenRecommendation))

      const downloadSteps = buildDownloadSteps(nextLtxRecommendation, nextImgGenRecommendation)
      if (downloadSteps.length === 0) {
        setCurrentStep('complete')
        return
      }

      downloadQueueRef.current = downloadSteps.slice(1)
      await startDownloadStep(downloadSteps[0])
    } catch (e) {
      logger.error(`Download start error: ${e}`)
      setDownloadError(e instanceof Error ? e.message : 'Nie udało się rozpocząć pobierania modelu.')
    }
  }

  const retryInstallation = () => {
    setDownloadError(null)
    downloadQueueRef.current = []
    startInstallation()
  }

  // Handle next button
  const handleNext = async () => {
    setActionError(null)
    if (currentStep === 'license') {
      if (!licenseAccepted) return
      setIsActionPending(true)
      try {
        if (onAcceptLicense) {
          await onAcceptLicense()
        }
        if (licenseOnly) {
          await onComplete()
          return
        }
        setCurrentStep('location')
      } catch (e) {
        setActionError(e instanceof Error ? e.message : 'Nie udało się zaakceptować licencji.')
      } finally {
        setIsActionPending(false)
      }
      return
    }
    if (currentStep === 'location') {
      startInstallation()
      return
    }
    if (currentStep === 'complete') {
      await handleFinish()
    }
  }

  const handleFinish = async () => {
    setActionError(null)
    setIsActionPending(true)
    try {
      await onComplete()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Nie udało się zakończyć konfiguracji.')
    } finally {
      setIsActionPending(false)
    }
  }

  // Get button text
  const getNextButtonText = () => {
    if (currentStep === 'license') return licenseOnly ? 'Akceptuj' : 'Dalej'
    if (currentStep === 'location') return 'Zainstaluj'
    if (currentStep === 'complete') return 'Zakończ'
    return 'Kontynuuj'
  }

  // Check if next button should be disabled
  const isNextDisabled = () => {
    if (currentStep === 'license') return !licenseAccepted || isActionPending
    if (currentStep === 'location') return hfAuthStatus !== 'authenticated' || !allAuthorized
    if (currentStep === 'complete') return isActionPending
    return false
  }

  return (
    <div className="h-screen flex flex-col" style={{
      background: '#000000',
      fontFamily: 'Arial, Helvetica, sans-serif',
      color: '#ffffff'
    }}>
      {/* Custom Title Bar */}
      <div style={{
        height: 32,
        background: '#000000',
        display: 'flex',
        alignItems: 'center',
        paddingLeft: 80,
        borderBottom: '1px solid #1a1a1a',
        // @ts-expect-error - Electron-specific CSS property
        WebkitAppRegion: 'drag'
      }}>
      </div>

      {/* Main Container */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        overflow: 'hidden',
        minHeight: 0,
        // @ts-expect-error - Electron-specific CSS property
        WebkitAppRegion: 'no-drag'
      }}>
        {/* Header */}
        <div style={{
          padding: currentStep === 'installing' ? '12px 32px' : '16px 32px',
          borderBottom: '1px solid #1a1a1a'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {/* LARA Anime Forge Logo */}
            <LtxLogo />
          </div>
        </div>

        {/* Content Area */}
        <div style={{
          flex: 1,
          padding: currentStep === 'installing' ? 0 : '28px 32px',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}>
          {/* Step 1: Model License */}
          {currentStep === 'license' && (
            <div style={{ animation: 'fadeIn 0.25s ease', display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1 }}>
              <h2 style={{
                fontFamily: "'Miriam Libre', serif",
                fontSize: 24,
                fontWeight: 700,
                marginBottom: 6
              }}>
                Licencja modelu LTX-2
              </h2>
              <p style={{ color: '#a0a0a0', fontSize: 14, marginBottom: 16 }}>
                Model LTX-2 podlega poniższej umowie licencyjnej. Przeczytaj ją i zaakceptuj przed rozpoczęciem pobierania.
              </p>

              <div style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                minHeight: 0
              }}>
                <div style={{
                  flex: 1,
                  overflow: 'hidden',
                  borderRadius: 8,
                  minHeight: 0
                }}>
                  {licenseError ? (
                    <div style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      height: '100%',
                      gap: 12
                    }}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"/>
                        <line x1="12" y1="8" x2="12" y2="12"/>
                        <line x1="12" y1="16" x2="12.01" y2="16"/>
                      </svg>
                      <span style={{ color: '#f87171', fontSize: 13, textAlign: 'center' }}>{licenseError}</span>
                      <button
                        onClick={fetchLicense}
                        style={{
                          padding: '6px 20px',
                          borderRadius: 9999,
                          fontSize: 13,
                          fontWeight: 600,
                          cursor: 'pointer',
                          background: 'linear-gradient(125deg, #A98BD9, #6D28D9)',
                          border: 'none',
                          color: '#ffffff',
                        }}
                      >
                        Spróbuj ponownie
                      </button>
                    </div>
                  ) : licenseText === null ? (
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      height: '100%',
                      gap: 10
                    }}>
                      <svg width="20" height="20" viewBox="0 0 24 24" style={{ animation: 'spin 1s linear infinite' }}>
                        <circle cx="12" cy="12" r="10" stroke="#6D28D9" strokeWidth="3" fill="none" strokeDasharray="31.4 31.4" strokeLinecap="round" />
                      </svg>
                      <span style={{ color: '#a0a0a0', fontSize: 13 }}>Wczytywanie licencji...</span>
                    </div>
                  ) : (
                    <div style={{
                      overflowY: 'auto',
                      height: '100%',
                      background: '#1a1a1a',
                      borderRadius: 8,
                      padding: 40
                    }}>
                      <pre style={{
                        fontFamily: "'Consolas', 'Monaco', monospace",
                        fontSize: 11,
                        lineHeight: 1.5,
                        color: '#d0d0d0',
                        margin: 0,
                        whiteSpace: 'pre-line',
                        wordWrap: 'break-word',
                        width: '100%'
                      }}>
                        {licenseText?.replace(/([^\n])\n([^\n])/g, '$1 $2')}
                      </pre>
                    </div>
                  )}
                </div>

                <label style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  marginTop: 14,
                  cursor: 'pointer',
                  fontSize: 13,
                  userSelect: 'none'
                }}>
                  <input
                    type="checkbox"
                    checked={licenseAccepted}
                    onChange={(e) => setLicenseAccepted(e.target.checked)}
                    style={{
                      width: 16,
                      height: 16,
                      accentColor: '#2B61FF',
                      cursor: 'pointer',
                      flexShrink: 0
                    }}
                  />
                  <span>Akceptuję warunki licencji społecznościowej LTX-2</span>
                </label>
              </div>
            </div>
          )}

          {/* Step 2: Wybierz lokalizację */}
          {currentStep === 'location' && (
            <div style={{ animation: 'fadeIn 0.25s ease', overflowY: 'auto', flex: 1, minHeight: 0 }}>
              <h2 style={{
                fontFamily: "'Miriam Libre', serif",
                fontSize: 24,
                fontWeight: 700,
                marginBottom: 6
              }}>
                Wybierz lokalizację
              </h2>
              <p style={{ color: '#a0a0a0', fontSize: 14, marginBottom: 24 }}>
                Wybierz folder, w którym zostaną zainstalowane pliki modeli.
              </p>

              <div style={{
                background: '#2e3445',
                borderRadius: 12,
                padding: '14px 18px'
              }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <input
                    type="text"
                    value={installPath}
                    readOnly
                    style={{
                      flex: 1,
                      background: '#1a1a1a',
                      border: '1px solid #333',
                      borderRadius: 8,
                      padding: '12px 14px',
                      color: '#ffffff',
                      fontSize: 13,
                      fontFamily: "'Consolas', 'Monaco', monospace"
                    }}
                  />
                  <button
                    onClick={async () => {
                      const result = await window.electronAPI?.openModelsDirChangeDialog()
                      if (result?.success) {
                        setInstallPath(result.path)
                      }
                    }}
                    style={{
                      padding: '10px 28px',
                      borderRadius: 9999,
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: 'pointer',
                      background: 'transparent',
                      border: '1px solid #444',
                      color: '#ffffff',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    Przeglądaj
                  </button>
                </div>

                <div style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  fontSize: 12,
                  color: '#a0a0a0',
                  marginTop: 10
                }}>
                  <span>Dostępne miejsce: <strong style={{ color: '#fff' }}>{availableSpace}</strong></span>
                </div>
              </div>

              {/* LTX API Key - Optional but saves ~25 GB download */}
              <div style={{
                marginTop: 24,
                background: '#2e3445',
                borderRadius: 12,
                padding: '14px 18px'
              }}>
                <div style={{ marginBottom: 8 }}>
                  <label style={{ fontSize: 13, fontWeight: 600, color: '#ffffff' }}>
                    LTX API Key
                    <span style={{
                      fontSize: 11,
                      color: '#A98BD9',
                      marginLeft: 8,
                      fontWeight: 400
                    }}>
                      Opcjonalny • oszczędza pobieranie około 25 GB
                    </span>
                  </label>
                </div>
                <input
                  type="password"
                  value={ltxApiKey}
                  onChange={(e) => setLtxApiKey(e.target.value)}
                  placeholder="Wpisz klucz API, aby pominąć pobieranie kodera tekstu..."
                  style={{
                    width: '100%',
                    background: '#1a1a1a',
                    border: '1px solid #333',
                    borderRadius: 8,
                    padding: '12px 14px',
                    color: '#ffffff',
                    fontSize: 13,
                    boxSizing: 'border-box'
                  }}
                />
                <p style={{ fontSize: 11, color: '#888', marginTop: 8 }}>
                  {ltxApiKey ? (
                    <span style={{ color: '#6D28D9' }}>
                      ✓ Pobieranie kodera tekstu zostanie pominięte, ponieważ użyte zostanie API
                    </span>
                  ) : (
                    'Wpisanie klucza LTX API pozwala pominąć pobieranie kodera tekstu o rozmiarze około 25 GB. ' +
                    'API zapewnia szybsze kodowanie tekstu, około 1 sekundy zamiast około 23 sekund lokalnie.'
                  )}
                </p>
              </div>

              {/* HuggingFace Authentication */}
              {window.electronAPI.hfGatingEnabled && (
              <div style={{
                marginTop: 24,
                background: '#2e3445',
                borderRadius: 12,
                padding: '14px 18px'
              }}>
                <div style={{ marginBottom: 8 }}>
                  <label style={{ fontSize: 13, fontWeight: 600, color: '#ffffff' }}>
                    Konto Hugging Face
                    <span style={{
                      fontSize: 11,
                      color: hfAuthStatus === 'authenticated' ? '#22c55e' : '#f59e0b',
                      marginLeft: 8,
                      fontWeight: 400
                    }}>
                      {hfAuthStatus === 'authenticated' ? 'Zalogowano' : 'Wymagane'}
                    </span>
                  </label>
                </div>
                {hfAuthStatus === 'authenticated' ? (
                  <p style={{ fontSize: 12, color: '#22c55e' }}>
                    ✓ Uwierzytelniono. Można pobierać modele.
                  </p>
                ) : (
                  <>
                    <p style={{ fontSize: 11, color: '#888', marginBottom: 12 }}>
                      Zaloguj się do Hugging Face, aby pobrać pliki modeli.
                    </p>
                    <button
                      onClick={startHuggingFaceLogin}
                      disabled={hfAuthPolling}
                      style={{
                        padding: '10px 28px',
                        borderRadius: 9999,
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: hfAuthPolling ? 'default' : 'pointer',
                        background: hfAuthPolling ? '#333' : '#4f46e5',
                        border: 'none',
                        color: '#ffffff',
                        transition: 'all 0.2s ease',
                        opacity: hfAuthPolling ? 0.7 : 1
                      }}
                    >
                      {hfAuthPolling ? 'Oczekiwanie na logowanie...' : 'Zaloguj się przez Hugging Face'}
                    </button>
                  </>
                )}
              </div>
              )}

              {/* Dostęp do modeli Check */}
              {hfAuthStatus === 'authenticated' && Object.keys(accessMap).length > 0 && !allAuthorized && (
                <div ref={modelAccessRef} style={{
                  marginTop: 24,
                  background: '#2e3445',
                  borderRadius: 12,
                  padding: '14px 18px'
                }}>
                  <div style={{ marginBottom: 8 }}>
                    <label style={{ fontSize: 13, fontWeight: 600, color: '#ffffff' }}>
                      Dostęp do modeli
                      <span style={{ fontSize: 11, color: '#f59e0b', marginLeft: 8, fontWeight: 400 }}>
                        Wymagane działanie
                      </span>
                    </label>
                  </div>
                  <p style={{ fontSize: 11, color: '#888', marginBottom: 12 }}>
                    Niektóre modele wymagają zaakceptowania licencji w serwisie Hugging Face przed pobraniem.
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {Object.entries(accessMap)
                      .filter(([, status]) => status === 'not_authorized')
                      .map(([repoId]) => (
                        <div key={repoId} style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          background: '#1a1a1a',
                          borderRadius: 8,
                          padding: '10px 14px',
                        }}>
                          <span style={{ fontSize: 12, color: '#a0a0a0', fontFamily: "'Consolas', 'Monaco', monospace" }}>
                            {repoId}
                          </span>
                          <button
                            onClick={() => window.electronAPI.openHuggingFaceRepo({ repoId })}
                            style={{
                              padding: '6px 16px',
                              borderRadius: 9999,
                              fontSize: 12,
                              fontWeight: 600,
                              cursor: 'pointer',
                              background: '#4f46e5',
                              border: 'none',
                              color: '#ffffff',
                              transition: 'all 0.2s ease',
                            }}
                          >
                            Poproś o dostęp
                          </button>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 3: Installing */}
          {currentStep === 'installing' && (
            <div style={{
              position: 'relative',
              height: '100%',
              animation: 'fadeIn 0.25s ease'
            }}>
              {/* Video Section - fills container but leaves room for progress */}
              <div style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 140,
                background: '#0a0a0a',
                overflow: 'hidden'
              }}>
                {/* Splash Video */}
                <video
                  key={videoPath}
                  autoPlay
                  loop
                  muted
                  playsInline
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    display: 'block'
                  }}
                >
                  <source src={videoPath} type="video/mp4" />
                </video>

                {/* Video Credit */}
                <div style={{
                  position: 'absolute',
                  bottom: 20,
                  left: 24,
                  fontFamily: "'Miriam Libre', serif",
                  fontSize: 13,
                  color: 'rgba(255,255,255,0.75)',
                  textShadow: '0 1px 4px rgba(0,0,0,0.9)',
                  zIndex: 10
                }}>
                  Wygenerowano przez PongFlongo
                </div>
              </div>

              {/* Progress Section - fixed at bottom */}
              <div style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 0,
                height: 140,
                background: '#0d0d0d',
                padding: '16px 24px',
                borderTop: '1px solid #2a2a2a'
              }}>
              {downloadError ? (
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                  gap: 10,
                }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                  <span style={{ color: '#f87171', fontSize: 13, textAlign: 'center', maxWidth: 400 }}>{downloadError}</span>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button
                      onClick={() => { setDownloadError(null); setCurrentStep('location') }}
                      style={{
                        padding: '6px 20px',
                        borderRadius: 9999,
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: 'pointer',
                        background: 'transparent',
                        border: '1px solid #444',
                        color: '#ffffff',
                      }}
                    >
                      Wstecz
                    </button>
                    <button
                      onClick={retryInstallation}
                      style={{
                        padding: '6px 20px',
                        borderRadius: 9999,
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: 'pointer',
                        background: 'linear-gradient(125deg, #A98BD9, #6D28D9)',
                        border: 'none',
                        color: '#ffffff',
                      }}
                    >
                      Spróbuj ponownie
                    </button>
                  </div>
                </div>
              ) : (
              <>
                {/* Header row with status and percentage */}
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 8
                }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>
                    {totalProgress > 85 ? 'Instalowanie...' : 'Pobieranie...'}
                  </span>
                  <span style={{ fontSize: 13, color: '#A98BD9', fontWeight: 600 }}>
                    {Math.round(totalProgress)}%
                  </span>
                </div>

                {/* Progress Bar */}
                <div style={{
                  height: 6,
                  background: '#1a1a1a',
                  borderRadius: 3,
                  overflow: 'hidden'
                }}>
                  <div style={{
                    height: '100%',
                    background: 'linear-gradient(125deg, #A98BD9, #6D28D9, #194DF9)',
                    backgroundSize: '200% 200%',
                    animation: 'gradientShift 3s ease infinite',
                    borderRadius: 3,
                    width: `${totalProgress}%`,
                    transition: 'width 0.3s ease'
                  }} />
                </div>

                {/* Download stats row */}
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginTop: 10,
                  fontSize: 12,
                  color: '#a0a0a0'
                }}>
                  {/* Current file */}
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {runningDownloadProgress?.current_downloading_file || installMessage}
                  </span>

                  {/* Speed and ETA */}
                  <div style={{ display: 'flex', gap: 16, marginLeft: 16, flexShrink: 0 }}>
                    {runningDownloadProgress && runningDownloadProgress.speed_bytes_per_sec > 0 && (
                      <span style={{ color: '#6D28D9', fontWeight: 500 }}>
                        {(runningDownloadProgress.speed_bytes_per_sec / (1024 * 1024)).toFixed(1)} MB/s
                      </span>
                    )}
                    {runningDownloadProgress && runningDownloadProgress.expected_total_bytes > 0 && (
                      <span>
                        {formatBytes(runningDownloadProgress.total_downloaded_bytes)} / {formatBytes(runningDownloadProgress.expected_total_bytes)}
                      </span>
                    )}
                    {runningDownloadProgress && runningDownloadProgress.speed_bytes_per_sec > 0 && (
                      <span>
                        Pozostało: {getTimeRemaining()}
                      </span>
                    )}
                  </div>
                </div>

                {/* Files progress */}
                {runningDownloadProgress && runningDownloadProgress.all_files.length > 0 && (
                  <div style={{
                    marginTop: 6,
                    fontSize: 11,
                    color: '#666'
                  }}>
                    Plik {runningDownloadProgress.completed_files.length + 1} z {runningDownloadProgress.all_files.length}
                  </div>
                )}
              </>
              )}
              </div>
            </div>
          )}

          {/* Step 4: Complete */}
          {currentStep === 'complete' && (
            <div style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              animation: 'fadeIn 0.25s ease'
            }}>
              {/* Success Icon */}
              <div style={{
                width: 72,
                height: 72,
                background: 'linear-gradient(125deg, #A98BD9, #6D28D9, #194DF9)',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 20
              }}>
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </div>

              <h2 style={{
                fontFamily: "'Miriam Libre', serif",
                fontSize: 26,
                fontWeight: 700,
                marginBottom: 8
              }}>
                Gotowe do tworzenia
              </h2>
              <p style={{ color: '#a0a0a0', fontSize: 14, maxWidth: 320 }}>
                Modele LTX zostały zainstalowane. Możesz rozpocząć tworzenie.
              </p>

              {/* Install Summary */}
              <div style={{
                background: '#2e3445',
                borderRadius: 12,
                padding: '16px 28px',
                marginTop: 20,
                textAlign: 'left',
                minWidth: 260
              }}>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '8px 0',
                  fontSize: 13
                }}>
                  <span style={{ color: '#a0a0a0' }}>Lokalizacja</span>
                  <span style={{ fontWeight: 500, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {installPath.split('\\').pop() || installPath}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: currentStep === 'installing' ? '12px 24px' : '16px 32px',
          borderTop: '1px solid #1a1a1a',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div style={{ fontSize: 11, color: '#666' }}>LARA Anime Forge • na bazie LTX Desktop • Apache-2.0</div>

          <div style={{ display: 'flex', gap: 10 }}>
            {/* Next/Install/Finish Button */}
            {currentStep !== 'installing' && (
              <button
                onClick={() => void handleNext()}
                disabled={isNextDisabled()}
                style={{
                  padding: '10px 28px',
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: isNextDisabled() ? 'not-allowed' : 'pointer',
                  background: isNextDisabled() ? '#555' : '#2B61FF',
                  border: 'none',
                  color: '#ffffff',
                  transition: 'all 0.2s ease',
                  opacity: isNextDisabled() ? 0.6 : 1
                }}
              >
                {getNextButtonText()}
              </button>
            )}
          </div>
        </div>
        {actionError && (
          <div style={{ padding: '0 32px 12px 32px', color: '#fca5a5', fontSize: 12 }}>
            {actionError}
          </div>
        )}
      </div>

    </div>
  )
}
