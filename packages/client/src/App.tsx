import { useState, useEffect, useCallback } from 'react';
import { Document } from '@stashd/shared';
import { listDocuments, listCategories, CategoryWithCount } from './api/client';
import { Toolbar, ToolbarButton, PrimaryButton, SearchField } from './components/chrome';
import Sidebar, { NavTarget } from './components/Sidebar';
import InboxView, { PendingJob } from './components/InboxView';
import CategoryView from './components/CategoryView';
import DetailView from './components/DetailView';
import ReviewView from './components/ReviewView';
import UploadOverlay from './components/UploadOverlay';
import { IconArrowLeft, IconStar, IconEdit, IconMoreH, IconPlus } from './components/icons';

type AppView = 'inbox' | 'category' | 'detail' | 'review';

export default function App() {
  const [view, setView] = useState<AppView>('inbox');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null);
  const [prevView, setPrevView] = useState<{ view: AppView; categoryId: string | null }>({ view: 'inbox', categoryId: null });

  const [docs, setDocs] = useState<Document[]>([]);
  const [categories, setCategories] = useState<CategoryWithCount[]>([]);
  const [pendingJobs, setPendingJobs] = useState<PendingJob[]>([]);

  const [search, setSearch] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(true);

  // Initial data load
  useEffect(() => {
    Promise.all([listDocuments(), listCategories()])
      .then(([d, c]) => { setDocs(d); setCategories(c); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // Refresh docs list
  const refreshDocs = useCallback(async () => {
    try {
      const [d, c] = await Promise.all([listDocuments(), listCategories()]);
      setDocs(d);
      setCategories(c);
    } catch (err) {
      console.error(err);
    }
  }, []);

  // Global drag-and-drop
  useEffect(() => {
    const onEnter = (e: DragEvent) => { e.preventDefault(); setDragOver(true); };
    const onLeave = (e: DragEvent) => { if (e.relatedTarget == null) setDragOver(false); };
    const onOver = (e: DragEvent) => e.preventDefault();
    const onDrop = (e: DragEvent) => { e.preventDefault(); setDragOver(false); setUploadOpen(true); };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  function navigate(target: NavTarget) {
    if (view !== 'detail') setPrevView({ view, categoryId });
    if (target.view === 'inbox') {
      setView('inbox');
      setCategoryId(null);
    } else {
      setView('category');
      setCategoryId(target.categoryId);
    }
    setSelectedDoc(null);
  }

  function openDoc(doc: Document) {
    setPrevView({ view, categoryId });
    setSelectedDoc(doc);
    setView('detail');
  }

  function backFromDetail() {
    setView(prevView.view);
    setCategoryId(prevView.categoryId);
    setSelectedDoc(null);
  }

  function handleUploadComplete(jobs: PendingJob[]) {
    setPendingJobs(prev => [...jobs, ...prev]);
    setUploadOpen(false);
    if (jobs.length > 0) setView('review');
  }

  function handleFiled(jobId: string) {
    setPendingJobs(prev => prev.filter(j => j.jobId !== jobId));
    refreshDocs();
    if (pendingJobs.length <= 1) setView('inbox');
  }

  function handleQuickFile(jobId: string) {
    const job = pendingJobs.find(j => j.jobId === jobId);
    if (!job) return;
    import('./api/client').then(({ fileDocument }) => {
      fileDocument(jobId, {
        category: job.classification.category,
        subcategory: job.classification.subcategory,
        tags: job.classification.tags ?? [],
        summary: job.classification.summary ?? '',
        dateExtracted: job.classification.date,
        amount: job.classification.amount,
        vendor: job.classification.vendor,
        confidenceScore: job.classification.confidence,
      }).then(() => {
        handleFiled(jobId);
      }).catch(console.error);
    });
  }

  function handleDocUpdated(updated: Document) {
    setDocs(prev => prev.map(d => d.id === updated.id ? updated : d));
    if (selectedDoc?.id === updated.id) setSelectedDoc(updated);
  }

  const toolbarTitle = (() => {
    if (view === 'detail' && selectedDoc) return selectedDoc.originalName;
    if (view === 'review') return 'Review & file';
    if (view === 'category' && categoryId === '__all') return 'All Documents';
    if (view === 'category' && categoryId) {
      const cat = categories.find(c => c.id === categoryId);
      return cat?.name ?? categoryId;
    }
    return 'Inbox';
  })();

  return (
    <div style={{
      width: '100vw', height: '100vh',
      overflow: 'hidden',
      background: 'var(--bg)',
      display: 'flex', position: 'relative',
    }}>
      {/* Sidebar */}
      <Sidebar
        view={view}
        categoryId={categoryId}
        onNavigate={navigate}
        categories={categories}
        totalDocs={docs.length}
        pendingCount={pendingJobs.length}
      />

      {/* Main column */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, position: 'relative' }}>
        <Toolbar
          left={
            view === 'detail' ? (
              <>
                <ToolbarButton onClick={backFromDetail}>
                  <IconArrowLeft size={14} />
                  <span>Back</span>
                </ToolbarButton>
                <div style={{
                  fontSize: 12.5, fontWeight: 600, color: 'var(--ink-2)',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  maxWidth: 360, paddingLeft: 4, letterSpacing: -0.05,
                }}>{toolbarTitle}</div>
              </>
            ) : (
              <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-2)', letterSpacing: -0.05 }}>
                {toolbarTitle}
              </div>
            )
          }
          center={
            view !== 'detail' && view !== 'review' ? (
              <SearchField value={search} onChange={setSearch} />
            ) : null
          }
          right={
            view === 'detail' ? (
              <>
                <ToolbarButton title="Star"><IconStar size={15} /></ToolbarButton>
                <ToolbarButton title="Edit"><IconEdit size={15} /></ToolbarButton>
                <ToolbarButton title="More"><IconMoreH size={15} /></ToolbarButton>
              </>
            ) : (
              <>
                <ToolbarButton title="More"><IconMoreH size={15} /></ToolbarButton>
                <PrimaryButton onClick={() => setUploadOpen(true)}>
                  <IconPlus size={14} />Add
                </PrimaryButton>
              </>
            )
          }
        />

        {/* Content */}
        <div style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
          {loading ? (
            <div style={{ padding: '80px 32px', textAlign: 'center', color: 'var(--ink-4)', fontSize: 13 }}>
              Loading…
            </div>
          ) : view === 'detail' && selectedDoc ? (
            <DetailView
              doc={selectedDoc}
              onCategoryClick={(id) => navigate({ view: 'category', categoryId: id })}
              onDocUpdated={handleDocUpdated}
            />
          ) : view === 'review' ? (
            <ReviewView
              pendingJobs={pendingJobs}
              onFiled={handleFiled}
              onSkip={() => {}}
              onDiscard={(jobId) => setPendingJobs(prev => prev.filter(j => j.jobId !== jobId))}
            />
          ) : view === 'category' && categoryId ? (
            <CategoryView categoryId={categoryId} docs={docs} onSelect={openDoc} />
          ) : (
            <InboxView
              docs={docs}
              pendingJobs={pendingJobs}
              search={search}
              onSelect={openDoc}
              onOpenReview={() => setView('review')}
              onQuickFile={handleQuickFile}
            />
          )}
        </div>
      </div>

      {/* Drag overlay */}
      {dragOver ? (
        <div style={{
          position: 'absolute', inset: 0,
          border: '2px dashed var(--accent)',
          background: 'rgba(13,111,106,0.08)',
          backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
          zIndex: 40, pointerEvents: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column', gap: 12, color: 'var(--accent)',
        }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600 }}>
            Drop to stash
          </div>
        </div>
      ) : null}

      {/* Upload overlay */}
      <UploadOverlay
        visible={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onComplete={handleUploadComplete}
      />
    </div>
  );
}
