import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Folder, MoreVertical, Trash2, Pencil } from 'lucide-react'
import { useProjects } from '../contexts/ProjectContext'
import { useView } from '../contexts/ViewContext'
import { LtxLogo } from '../components/LtxLogo'
import { Button } from '../components/ui/button'
import { pathToFileUrl } from '../lib/file-url'
import type { Project } from '../types/project-model'
import { useProjectReferencesMigration } from '../hooks/useProjectReferencesMigration'

function formatDate(timestamp: number): string {
  const date = new Date(timestamp)

  return date.toLocaleDateString('pl-PL', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function ProjectCard({
  project,
  onOpen,
  onDelete,
  onRename
}: {
  project: Project
  onOpen: () => void
  onDelete: () => void
  onRename: () => void
}) {
  const [showMenu, setShowMenu] = useState(false)
  const [imgError, setImgError] = useState(false)

  const representativeAsset =
    project.assets.find(asset => asset.type === 'image')
    || project.assets[0]
    || null

  const representativeUrl = representativeAsset?.path
    ? pathToFileUrl(representativeAsset.path)
    : null

  const representativeBigThumbnailUrl =
    representativeAsset?.bigThumbnailPath
      ? pathToFileUrl(representativeAsset.bigThumbnailPath)
      : null

  return (
    <div
      className="group relative bg-zinc-900 rounded-lg overflow-hidden border border-zinc-800 hover:border-zinc-700 transition-colors cursor-pointer"
      onClick={onOpen}
    >
      <div className="aspect-video bg-zinc-800 flex items-center justify-center relative overflow-hidden">
        {representativeAsset && !imgError ? (
          representativeAsset.type === 'video' ? (
            representativeBigThumbnailUrl ? (
              <img
                src={representativeBigThumbnailUrl}
                alt={project.name}
                className="w-full h-full object-cover"
                onError={() => setImgError(true)}
              />
            ) : representativeUrl ? (
              <video
                src={representativeUrl}
                className="w-full h-full object-cover"
                muted
                preload="metadata"
                onError={() => setImgError(true)}
              />
            ) : (
              <Folder className="h-12 w-12 text-zinc-600" />
            )
          ) : representativeUrl ? (
            <img
              src={representativeUrl}
              alt={project.name}
              className="w-full h-full object-cover"
              onError={() => setImgError(true)}
            />
          ) : (
            <Folder className="h-12 w-12 text-zinc-600" />
          )
        ) : (
          <Folder className="h-12 w-12 text-zinc-600" />
        )}

        <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>

      <div className="p-3">
        <h3 className="font-medium text-white truncate">
          {project.name}
        </h3>

        <p className="text-xs text-zinc-500 mt-1">
          {formatDate(project.updatedAt)}
        </p>
      </div>

      <button
        type="button"
        aria-label="Menu projektu"
        onClick={(event) => {
          event.stopPropagation()
          setShowMenu(!showMenu)
        }}
        className="absolute top-2 right-2 p-1.5 rounded bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/70"
      >
        <MoreVertical className="h-4 w-4 text-white" />
      </button>

      {showMenu && (
        <div
          className="absolute top-10 right-2 bg-zinc-800 rounded-lg shadow-lg border border-zinc-700 py-1 z-10 min-w-[150px]"
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              onRename()
              setShowMenu(false)
            }}
            className="w-full px-3 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-700 flex items-center gap-2"
          >
            <Pencil className="h-4 w-4" />
            Zmień nazwę
          </button>

          <button
            type="button"
            onClick={() => {
              onDelete()
              setShowMenu(false)
            }}
            className="w-full px-3 py-2 text-left text-sm text-red-400 hover:bg-zinc-700 flex items-center gap-2"
          >
            <Trash2 className="h-4 w-4" />
            Usuń
          </button>
        </div>
      )}
    </div>
  )
}

export function Home() {
  const {
    projectIds,
    getProject,
    createProject,
    deleteProject,
    renameProject
  } = useProjects()

  const { openProject } = useView()

  const {
    migrationStatus,
    migrateProjects
  } = useProjectReferencesMigration()

  const [isCreating, setIsCreating] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const migrationStartedRef = useRef(false)

  useEffect(() => {
    if (
      migrationStatus.status !== 'needed'
      || migrationStartedRef.current
    ) {
      return
    }

    migrationStartedRef.current = true
    void migrateProjects()
  }, [migrateProjects, migrationStatus.status])

  const projects = useMemo(
    () =>
      projectIds
        .map(projectId => getProject(projectId))
        .filter(
          (project): project is Project =>
            project !== null
        ),
    [getProject, projectIds]
  )

  const handleCreateProject = () => {
    const trimmedName = newProjectName.trim()

    if (!trimmedName) {
      return
    }

    const project = createProject(trimmedName)

    setNewProjectName('')
    setIsCreating(false)
    openProject(project.id)
  }

  const handleRenameProject = (
    id: string,
    currentName: string
  ) => {
    setRenamingId(id)
    setRenameValue(currentName)
  }

  const submitRename = () => {
    const trimmedName = renameValue.trim()

    if (renamingId && trimmedName) {
      renameProject(renamingId, trimmedName)
    }

    setRenamingId(null)
    setRenameValue('')
  }

  if (
    migrationStatus.status === 'needed'
    || migrationStatus.status === 'inProgress'
  ) {
    const progressPct =
      migrationStatus.status === 'inProgress'
        ? migrationStatus.ratio * 100
        : 0

    return (
      <div className="h-screen bg-background flex items-center justify-center">
        <div className="w-[360px]">
          <p className="text-center text-sm text-zinc-300 mb-4">
            Przenoszenie danych projektów...
          </p>

          <div className="h-2 w-full rounded-full bg-zinc-800 overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all duration-150"
              style={{
                width: `${Math.max(
                  0,
                  Math.min(100, progressPct)
                )}%`
              }}
            />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen bg-background flex">
      <aside className="w-64 border-r border-zinc-800 flex flex-col">
        <div className="p-6">
          <LtxLogo className="h-6 w-auto text-white" />
        </div>

        <nav className="flex-1 px-3">
          <button
            type="button"
            className="w-full px-3 py-2 rounded-lg bg-zinc-800 text-white text-left text-sm font-medium flex items-center gap-2"
          >
            <Folder className="h-4 w-4" />
            Strona główna
          </button>

          {projects.length > 0 && (
            <div className="mt-6">
              <h4 className="px-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                Ostatnie projekty
              </h4>

              {projects.slice(0, 5).map(project => (
                <button
                  type="button"
                  key={project.id}
                  onClick={() => openProject(project.id)}
                  className="w-full px-3 py-2 rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-white text-left text-sm flex items-center gap-2 transition-colors truncate"
                >
                  <Folder className="h-4 w-4 flex-shrink-0" />

                  <span className="truncate">
                    {project.name}
                  </span>
                </button>
              ))}
            </div>
          )}
        </nav>

        <div className="p-4 border-t border-zinc-800">
          <button
            type="button"
            onClick={() => setIsCreating(true)}
            className="w-full px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium flex items-center justify-center gap-2 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Nowy projekt
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <div className="relative h-72 overflow-hidden">
          <video
            src="./hero-video.mp4"
            autoPlay
            loop
            muted
            playsInline
            className="absolute inset-0 w-full h-full object-cover"
          />

          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-black/10" />

          <div className="absolute bottom-6 left-8 z-10">
            <h1 className="text-3xl font-bold text-white mb-2 drop-shadow-lg">
              LARA Anime Forge
            </h1>

            <p className="text-zinc-200 drop-shadow-md">
              Twórz i zarządzaj swoimi projektami filmowymi
            </p>
          </div>
        </div>

        <div className="p-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-white">
              Projekty
            </h2>
          </div>

          {projects.length === 0 ? (
            <div className="text-center py-16">
              <Folder className="h-16 w-16 text-zinc-700 mx-auto mb-4" />

              <h3 className="text-lg font-medium text-zinc-400 mb-2">
                Nie masz jeszcze żadnych projektów
              </h3>

              <p className="text-zinc-500 mb-6">
                Utwórz pierwszy projekt i rozpocznij pracę
              </p>

              <Button
                onClick={() => setIsCreating(true)}
                className="bg-blue-600 hover:bg-blue-500"
              >
                <Plus className="h-4 w-4 mr-2" />
                Utwórz projekt
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {projects.map(project => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  onOpen={() => openProject(project.id)}
                  onDelete={() => {
                    const shouldDelete = confirm(
                      `Czy na pewno usunąć projekt „${project.name}”?`
                    )

                    if (shouldDelete) {
                      deleteProject(project.id)
                    }
                  }}
                  onRename={() =>
                    handleRenameProject(
                      project.id,
                      project.name
                    )
                  }
                />
              ))}
            </div>
          )}
        </div>
      </main>

      {isCreating && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-zinc-900 rounded-xl p-6 w-full max-w-md border border-zinc-800">
            <h2 className="text-xl font-semibold text-white mb-4">
              Utwórz nowy projekt
            </h2>

            <input
              type="text"
              value={newProjectName}
              onChange={event =>
                setNewProjectName(event.target.value)
              }
              placeholder="Nazwa projektu"
              className="w-full px-4 py-3 rounded-lg bg-zinc-800 border border-zinc-700 text-white placeholder:text-zinc-500 focus:outline-none focus:border-blue-500"
              autoFocus
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  handleCreateProject()
                }
              }}
            />

            <div className="flex gap-3 mt-6">
              <Button
                variant="outline"
                onClick={() => {
                  setIsCreating(false)
                  setNewProjectName('')
                }}
                className="flex-1 border-zinc-700"
              >
                Anuluj
              </Button>

              <Button
                onClick={handleCreateProject}
                disabled={!newProjectName.trim()}
                className="flex-1 bg-blue-600 hover:bg-blue-500"
              >
                Utwórz
              </Button>
            </div>
          </div>
        </div>
      )}

      {renamingId && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-zinc-900 rounded-xl p-6 w-full max-w-md border border-zinc-800">
            <h2 className="text-xl font-semibold text-white mb-4">
              Zmień nazwę projektu
            </h2>

            <input
              type="text"
              value={renameValue}
              onChange={event =>
                setRenameValue(event.target.value)
              }
              placeholder="Nazwa projektu"
              className="w-full px-4 py-3 rounded-lg bg-zinc-800 border border-zinc-700 text-white placeholder:text-zinc-500 focus:outline-none focus:border-blue-500"
              autoFocus
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  submitRename()
                }
              }}
            />

            <div className="flex gap-3 mt-6">
              <Button
                variant="outline"
                onClick={() => {
                  setRenamingId(null)
                  setRenameValue('')
                }}
                className="flex-1 border-zinc-700"
              >
                Anuluj
              </Button>

              <Button
                onClick={submitRename}
                disabled={!renameValue.trim()}
                className="flex-1 bg-blue-600 hover:bg-blue-500"
              >
                Zapisz
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
