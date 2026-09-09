import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

interface NumeraFile {
  id: string;
  path: string;
  displayName: string;
  pinned: boolean;
  folderId: string | null;
  order: number;
}

interface NumeraFolder {
  id: string;
  name: string;
  pinned: boolean;
  collapsed: boolean;
  order: number;
}

interface RenameTarget {
  id: string;
  name: string;
  kind: 'file' | 'folder';
}

interface DeleteTarget {
  id: string;
  name: string;
  kind: 'file' | 'folder';
}

const ICONS = {
  menu: html`<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/></svg>`,
  file: html`<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/></svg>`,
  folder: html`<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>`,
  pin: html`<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M16 12V4H17V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>`,
  moreVert: html`<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>`,
  chevronRight: html`<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>`,
  expandMore: html`<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M16.59 8.59 12 13.17 7.41 8.59 6 10l6 6 6-6z"/></svg>`,
  upArrow: html`<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M4 12l1.41 1.41L11 7.83V20h2V7.83l5.59 5.58L20 12l-8-8z"/></svg>`,
  newFolder: html`<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M20 6h-8l-2-2H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2zm-1 8h-3v3h-2v-3h-3v-2h3V9h2v3h3v2z"/></svg>`,
  check: html`<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`,
  settings: html`<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84a.484.484 0 0 0-.48.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.488.488 0 0 0-.59.22L2.74 8.87a.49.49 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.27.41.48.41h3.84c.24 0 .44-.17.48-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>`,
  theme: html`<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z"/></svg>`,
};

@customElement('numera-sidebar')
export class NumeraSidebar extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
      position: relative;
      background-color: var(--md-sys-color-surface-container-low);
      color: var(--md-sys-color-on-surface);
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--md-sys-spacing-inline-tight);
      padding-inline: var(--md-sys-spacing-inline-tight) var(--md-sys-spacing-inline);
      height: var(--md-sys-app-bar-height);
    }

    .header-start {
      display: flex;
      align-items: center;
      gap: var(--md-sys-spacing-inline-tight);
      min-width: 0;
    }

    .brand {
      font-family: var(--md-sys-typescale-font-brand);
      font-size: var(--md-sys-typescale-title-large-size);
      line-height: var(--md-sys-typescale-title-large-line);
      font-weight: var(--md-sys-typescale-title-large-weight);
      letter-spacing: var(--md-sys-typescale-title-large-tracking);
      color: var(--md-sys-color-on-surface);
      white-space: nowrap;
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: var(--md-sys-spacing-inline-tight);
    }

    .file-list {
      flex: 1;
      overflow-y: auto;
      padding-block: var(--md-sys-spacing-block-tight);
    }

    md-list-item {
      --md-list-item-label-text-color: var(--md-sys-color-on-surface);
      --md-list-item-label-text-size: var(--md-sys-typescale-body-medium-size);
      --md-list-item-label-text-line-height: var(--md-sys-typescale-body-medium-line);
      --md-list-item-one-line-container-height: 40px;
      --md-list-item-top-space: 2px;
      --md-list-item-bottom-space: 2px;
      --md-list-item-leading-space: 12px;
      --md-list-item-trailing-space: 12px;
      --md-list-item-supporting-text-color: var(--md-sys-color-on-surface-variant);
      --md-list-item-hover-label-text-color: var(--md-sys-color-on-surface);
      --md-list-item-focus-label-text-color: var(--md-sys-color-on-surface);
      --md-list-item-container-color: transparent;
      --md-list-item-hover-container-color: color-mix(
        in srgb,
        var(--md-sys-color-on-surface) calc(var(--md-sys-state-hover-state-layer-opacity) * 100%),
        transparent
      );
      --md-list-item-focus-container-color: color-mix(
        in srgb,
        var(--md-sys-color-on-surface) calc(var(--md-sys-state-focus-state-layer-opacity) * 100%),
        transparent
      );
      cursor: pointer;
    }

    md-list-item[selected] {
      --md-list-item-container-color: var(--md-sys-color-secondary-container);
      --md-list-item-label-text-color: var(--md-sys-color-on-secondary-container);
      --md-list-item-supporting-text-color: var(--md-sys-color-on-secondary-container);
    }

    md-list-item[selected] .pin-button {
      --md-icon-button-icon-color: var(--md-sys-color-on-secondary-container);
    }

    .item-actions {
      display: inline-flex;
      align-items: center;
      gap: var(--md-sys-spacing-inline-tight);
    }

    .pin-button {
      --md-icon-button-icon-color: var(--md-sys-color-primary);
    }

    .overflow-anchor {
      position: relative;
      display: inline-flex;
    }

    .folder-name {
      font-weight: 500;
    }

    .folder-icon {
      color: var(--md-sys-color-primary);
    }

    .folder-children {
      padding-inline-start: var(--md-sys-spacing-block);
    }

    .drag-handle {
      cursor: grab;
      touch-action: none;
      color: var(--md-sys-color-on-surface-variant);
      flex-shrink: 0;
    }

    .drag-handle:active {
      cursor: grabbing;
    }

    md-list-item.dragging {
      opacity: 0.45;
    }

    md-list-item.drop-before {
      box-shadow: inset 0 2px 0 0 var(--md-sys-color-primary);
    }

    md-list-item.drop-into {
      --md-list-item-container-color: var(--md-sys-color-secondary-container);
      --md-list-item-label-text-color: var(--md-sys-color-on-secondary-container);
      --md-list-item-leading-icon-color: var(--md-sys-color-on-secondary-container);
      --md-list-item-trailing-icon-color: var(--md-sys-color-on-secondary-container);
      box-shadow: inset 0 0 0 2px var(--md-sys-color-primary);
    }

    md-list-item.drop-into .folder-icon {
      color: var(--md-sys-color-on-secondary-container);
    }

    .drop-to-root {
      position: absolute;
      inset-inline: var(--md-sys-spacing-inline-tight);
      top: calc(var(--md-sys-app-bar-height) + var(--md-sys-spacing-block-tight));
      z-index: 2;
      display: flex;
      align-items: center;
      gap: var(--md-sys-spacing-inline-tight);
      padding: var(--md-sys-spacing-inline-tight) var(--md-sys-spacing-inline);
      border: 2px dashed var(--md-sys-color-primary);
      border-radius: 8px;
      background-color: var(--md-sys-color-primary-container);
      color: var(--md-sys-color-on-primary-container);
      font-family: var(--md-sys-typescale-body-medium-font, inherit);
      font-size: var(--md-sys-typescale-body-medium-size);
      font-weight: var(--md-sys-typescale-body-medium-weight, 500);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    }

    .move-dialog-list {
      max-height: 40vh;
      overflow-y: auto;
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: var(--md-sys-spacing-inline);
      padding: var(--md-sys-spacing-section) var(--md-sys-spacing-block-loose);
      text-align: center;
      color: var(--md-sys-color-on-surface-variant);
    }

    .empty-state-title {
      font-family: var(--md-sys-typescale-title-small-font);
      font-size: var(--md-sys-typescale-title-small-size);
      line-height: var(--md-sys-typescale-title-small-line);
      font-weight: var(--md-sys-typescale-title-small-weight);
      letter-spacing: var(--md-sys-typescale-title-small-tracking);
      color: var(--md-sys-color-on-surface);
    }

    .empty-state-body {
      font-family: var(--md-sys-typescale-body-small-font);
      font-size: var(--md-sys-typescale-body-small-size);
      line-height: var(--md-sys-typescale-body-small-line);
      font-weight: var(--md-sys-typescale-body-small-weight);
      letter-spacing: var(--md-sys-typescale-body-small-tracking);
    }
  `;

  @property({ type: Array }) files: NumeraFile[] = [];

  @property({ type: Array }) folders: NumeraFolder[] = [];

  @property() selectedId = '';

  @state() private renameTarget: RenameTarget | null = null;

  @state() private renameOpen = false;

  @state() private createFolderOpen = false;

  @state() private createFolderMoveFileId: string | null = null;

  @state() private createFolderName = '';

  @state() private deleteTarget: DeleteTarget | null = null;

  @state() private deleteOpen = false;

  @state() private moveTarget: NumeraFile | null = null;

  @state() private moveOpen = false;

  @state() private draggingId: string | null = null;

  @state() private dropBeforeId: string | null = null;

  @state() private dropFolderId: string | null = null;

  @state() private dropToRoot = false;

  private drag: {
    id: string;
    folderId: string | null;
    pinned: boolean;
    pointerType: string;
    active: boolean;
    startX: number;
    startY: number;
  } | null = null;

  private holdTimer: ReturnType<typeof setTimeout> | null = null;

  private expandTimer: ReturnType<typeof setTimeout> | null = null;

  private expandFolderId: string | null = null;

  // -------------------------------------------------------------------------
  // Display order
  // -------------------------------------------------------------------------

  /** Members of a scope (folders only appear in the root scope) in display
   *  order: pinned first, then `order` ascending. */
  private scopeItems(scope: string | null): Array<
    { kind: 'folder'; folder: NumeraFolder } | { kind: 'file'; file: NumeraFile }
  > {
    const folderItems =
      scope === null
        ? this.folders.map(
            (folder): { kind: 'folder'; folder: NumeraFolder } => ({
              kind: 'folder',
              folder,
            }),
          )
        : [];
    const fileItems = this.files
      .filter((f) => f.folderId === scope)
      .map(
        (file): { kind: 'file'; file: NumeraFile } => ({ kind: 'file', file }),
      );
    const items = [...folderItems, ...fileItems];
    items.sort((a, b) => {
      const ap = a.kind === 'folder' ? a.folder.pinned : a.file.pinned;
      const bp = b.kind === 'folder' ? b.folder.pinned : b.file.pinned;
      if (ap !== bp) return ap ? -1 : 1;
      const ao = a.kind === 'folder' ? a.folder.order : a.file.order;
      const bo = b.kind === 'folder' ? b.folder.order : b.file.order;
      return ao - bo;
    });
    return items;
  }

  /** Files inside a folder, in display order. */
  private filesInFolder(folderId: string): NumeraFile[] {
    return this.files
      .filter((f) => f.folderId === folderId)
      .sort(
        (a, b) =>
          (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || a.order - b.order,
      );
  }

  /** The ordered "group" a dragged file may be reordered within: files of
   *  the same scope and pinned flag, excluding the dragged file itself. */
  private reorderGroup(scope: string | null, pinned: boolean): NumeraFile[] {
    return this.files
      .filter((f) => f.folderId === scope && f.pinned === pinned)
      .sort((a, b) => a.order - b.order);
  }

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  private dispatchSelect(id: string) {
    this.dispatchEvent(
      new CustomEvent('file-select', { detail: { id }, bubbles: true, composed: true }),
    );
  }

  private dispatchPin(id: string) {
    this.dispatchEvent(
      new CustomEvent('file-pin', { detail: { id }, bubbles: true, composed: true }),
    );
  }

  private dispatchRename(id: string, name: string) {
    this.dispatchEvent(
      new CustomEvent('file-rename', { detail: { id, name }, bubbles: true, composed: true }),
    );
  }

  private dispatchExport(id: string) {
    this.dispatchEvent(
      new CustomEvent('file-export', { detail: { id }, bubbles: true, composed: true }),
    );
  }

  private dispatchDelete(id: string) {
    this.dispatchEvent(
      new CustomEvent('file-delete', { detail: { id }, bubbles: true, composed: true }),
    );
  }

  private dispatchFileReorder(id: string, beforeId: string | null) {
    this.dispatchEvent(
      new CustomEvent('file-reorder', {
        detail: { id, beforeId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private dispatchFileMoveFolder(id: string, folderId: string | null) {
    this.dispatchEvent(
      new CustomEvent('file-move-folder', {
        detail: { id, folderId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private dispatchFolderToggle(id: string) {
    this.dispatchEvent(
      new CustomEvent('folder-toggle', { detail: { id }, bubbles: true, composed: true }),
    );
  }

  private dispatchFolderPin(id: string) {
    this.dispatchEvent(
      new CustomEvent('folder-pin', { detail: { id }, bubbles: true, composed: true }),
    );
  }

  private dispatchFolderRename(id: string, name: string) {
    this.dispatchEvent(
      new CustomEvent('folder-rename', { detail: { id, name }, bubbles: true, composed: true }),
    );
  }

  private dispatchFolderDelete(id: string) {
    this.dispatchEvent(
      new CustomEvent('folder-delete', { detail: { id }, bubbles: true, composed: true }),
    );
  }

  private dispatchFolderCreate(name: string, moveFileId?: string) {
    this.dispatchEvent(
      new CustomEvent('folder-create', {
        detail: { name, moveFileId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private dispatchCollapseToggle() {
    this.dispatchEvent(
      new CustomEvent('collapse-toggle', { bubbles: true, composed: true }),
    );
  }

  private dispatchThemeToggle() {
    this.dispatchEvent(
      new CustomEvent('theme-toggle', { bubbles: true, composed: true }),
    );
  }

  private dispatchSettingsOpen() {
    this.dispatchEvent(
      new CustomEvent('settings-open', { bubbles: true, composed: true }),
    );
  }

  // -------------------------------------------------------------------------
  // Menus + dialogs
  // -------------------------------------------------------------------------

  private openMenu(menuId: string) {
    const menu = this.renderRoot.querySelector<HTMLElement & { show(): void }>(
      `#${menuId}`,
    );
    menu?.show();
  }

  private openRenameDialog(target: RenameTarget) {
    this.renameTarget = target;
    this.renameOpen = true;
  }

  private closeRenameDialog() {
    this.renameOpen = false;
    this.renameTarget = null;
  }

  private confirmRename() {
    const input = this.renderRoot.querySelector<HTMLElement & { value: string }>(
      '#rename-input',
    );
    const name = input?.value.trim() ?? '';
    if (this.renameTarget && name) {
      if (this.renameTarget.kind === 'folder') {
        this.dispatchFolderRename(this.renameTarget.id, name);
      } else {
        this.dispatchRename(this.renameTarget.id, name);
      }
    }
    this.closeRenameDialog();
  }

  private handleRenameKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.confirmRename();
    }
  }

  private openCreateFolderDialog(moveFileId: string | null = null) {
    this.createFolderMoveFileId = moveFileId;
    this.createFolderName = '';
    this.createFolderOpen = true;
  }

  private closeCreateFolderDialog() {
    this.createFolderOpen = false;
    this.createFolderMoveFileId = null;
    this.createFolderName = '';
  }

  private handleCreateFolderInput(event: Event) {
    this.createFolderName = (event.target as HTMLInputElement).value;
  }

  private handleCreateFolderKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.confirmCreateFolder();
    }
  }

  private confirmCreateFolder() {
    const name = this.createFolderName.trim();
    if (name) {
      this.dispatchFolderCreate(name, this.createFolderMoveFileId ?? undefined);
    }
    this.closeCreateFolderDialog();
  }

  private openDeleteDialog(target: DeleteTarget) {
    this.deleteTarget = target;
    this.deleteOpen = true;
  }

  private closeDeleteDialog() {
    this.deleteOpen = false;
    this.deleteTarget = null;
  }

  private confirmDelete() {
    if (!this.deleteTarget) return;
    if (this.deleteTarget.kind === 'folder') {
      this.dispatchFolderDelete(this.deleteTarget.id);
    } else {
      this.dispatchDelete(this.deleteTarget.id);
    }
    this.closeDeleteDialog();
  }

  private openMoveDialog(file: NumeraFile) {
    this.moveTarget = file;
    this.moveOpen = true;
  }

  private closeMoveDialog() {
    this.moveOpen = false;
    this.moveTarget = null;
  }

  private moveFileTo(folderId: string | null) {
    if (!this.moveTarget) return;
    this.dispatchFileMoveFolder(this.moveTarget.id, folderId);
    this.closeMoveDialog();
  }

  private openCreateFolderFromMove() {
    if (!this.moveTarget) return;
    const fileId = this.moveTarget.id;
    this.closeMoveDialog();
    this.openCreateFolderDialog(fileId);
  }

  // -------------------------------------------------------------------------
  // Drag reorder
  // -------------------------------------------------------------------------

  private handleDragPointerDown(event: PointerEvent, file: NumeraFile) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    this.drag = {
      id: file.id,
      folderId: file.folderId,
      pinned: file.pinned,
      pointerType: event.pointerType,
      active: false,
      startX: event.clientX,
      startY: event.clientY,
    };
    this.holdTimer = setTimeout(() => this.activateDrag(), 250);
    window.addEventListener('pointermove', this.handleDragPointerMove);
    window.addEventListener('pointerup', this.handleDragPointerUp);
    window.addEventListener('pointercancel', this.handleDragPointerCancel);
  }

  private handleDragPointerMove = (event: PointerEvent) => {
    if (!this.drag) return;
    if (!this.drag.active) {
      const dx = event.clientX - this.drag.startX;
      const dy = event.clientY - this.drag.startY;
      if (Math.hypot(dx, dy) > 6) {
        // Touch requires a stationary long-press; mouse/pen can drag
        // directly once the pointer starts moving.
        if (this.drag.pointerType === 'touch') {
          this.cleanupDrag();
        } else {
          this.activateDrag();
        }
      }
      return;
    }
    event.preventDefault();
    const folderId = this.folderUnderPointer(event.clientY);
    if (folderId !== null) {
      this.dropFolderId = folderId;
      this.dropBeforeId = null;
      this.dropToRoot = false;
      this.scheduleFolderExpand(folderId);
    } else {
      this.dropFolderId = null;
      this.cancelFolderExpand();
      if (this.pointerInFolderChildren(event.clientY)) {
        this.dropToRoot = false;
        this.dropBeforeId = this.dropTargetFor(event.clientY);
      } else if (this.drag.folderId !== null) {
        // Dragged out of its folder into root space → move to root.
        this.dropToRoot = true;
        this.dropBeforeId = null;
      } else {
        // Root-level file: reorder within root.
        this.dropToRoot = false;
        this.dropBeforeId = this.dropTargetFor(event.clientY);
      }
    }
  };

  private handleDragPointerUp = () => {
    if (!this.drag) return;
    if (this.drag.active) {
      if (this.dropToRoot) {
        this.dispatchFileMoveFolder(this.drag.id, null);
      } else if (this.dropFolderId !== null && this.dropFolderId !== this.drag.folderId) {
        this.dispatchFileMoveFolder(this.drag.id, this.dropFolderId);
      } else if (this.dropFolderId === null) {
        this.dispatchFileReorder(this.drag.id, this.dropBeforeId);
      }
    }
    this.cleanupDrag();
  };

  private handleDragPointerCancel = () => {
    this.cleanupDrag();
  };

  private activateDrag() {
    if (!this.drag || this.drag.active) return;
    if (this.holdTimer) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
    this.drag.active = true;
    this.draggingId = this.drag.id;
    this.dropBeforeId = this.dropTargetFor(this.drag.startY);
  }

  private cleanupDrag() {
    if (this.holdTimer) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
    this.cancelFolderExpand();
    window.removeEventListener('pointermove', this.handleDragPointerMove);
    window.removeEventListener('pointerup', this.handleDragPointerUp);
    window.removeEventListener('pointercancel', this.handleDragPointerCancel);
    this.drag = null;
    this.draggingId = null;
    this.dropBeforeId = null;
    this.dropFolderId = null;
    this.dropToRoot = false;
  }

  /** Determine which folder row (if any) the pointer is over in the "move
   *  into folder" zone — the middle band (~30%–70%) of the row's height.
   *  Pointers in the top/bottom edges fall through so they can be treated as
   *  reorder positions instead. */
  private folderUnderPointer(clientY: number): string | null {
    const folderRows = this.renderRoot.querySelectorAll<HTMLElement>(
      '[data-folder-id]',
    );
    for (const el of folderRows) {
      const rect = el.getBoundingClientRect();
      if (clientY < rect.top || clientY > rect.bottom) continue;
      const bandTop = rect.top + rect.height * 0.3;
      const bandBottom = rect.top + rect.height * 0.7;
      if (clientY >= bandTop && clientY <= bandBottom) {
        return el.getAttribute('data-folder-id');
      }
    }
    return null;
  }

  /** Whether the pointer is vertically inside the dragged file's own folder
   *  children block (the sibling files it can be reordered among). */
  private pointerInFolderChildren(clientY: number): boolean {
    if (!this.drag?.folderId) return false;
    const block = this.renderRoot.querySelector<HTMLElement>(
      `[data-folder-children="${this.drag.folderId}"]`,
    );
    if (!block) return false;
    const rect = block.getBoundingClientRect();
    return clientY >= rect.top && clientY <= rect.bottom;
  }

  /** If the pointer is hovering a collapsed folder during a drag, expand it
   *  after a short delay so nested files become reachable drop targets. */
  private scheduleFolderExpand(folderId: string) {
    if (this.expandFolderId === folderId && this.expandTimer) return;
    this.cancelFolderExpand();
    const folder = this.folders.find((f) => f.id === folderId);
    if (!folder?.collapsed) return;
    this.expandFolderId = folderId;
    this.expandTimer = setTimeout(() => {
      this.expandTimer = null;
      this.expandFolderId = null;
      if (!this.drag?.active || this.dropFolderId !== folderId) return;
      const current = this.folders.find((f) => f.id === folderId);
      if (current?.collapsed) this.dispatchFolderToggle(folderId);
    }, 600);
  }

  private cancelFolderExpand() {
    if (this.expandTimer) {
      clearTimeout(this.expandTimer);
      this.expandTimer = null;
    }
    this.expandFolderId = null;
  }

  /** Determine which reorder-group member (a file OR, at root scope, a
   *  folder) the dragged item should be inserted before, based on the
   *  pointer's vertical position. Returns the member's id, or null to
   *  indicate "end of group". */
  private dropTargetFor(clientY: number): string | null {
    if (!this.drag) return null;

    interface Candidate {
      id: string;
      order: number;
      el: HTMLElement | null;
    }
    const candidates: Candidate[] = [];

    const files = this.reorderGroup(this.drag.folderId, this.drag.pinned);
    for (const file of files) {
      if (file.id === this.drag.id) continue;
      candidates.push({
        id: file.id,
        order: file.order,
        el: this.renderRoot.querySelector<HTMLElement>(
          `[data-file-id="${file.id}"]`,
        ),
      });
    }

    // Folders are reorder targets only at the root scope (they never appear
    // inside other folders).
    if (this.drag.folderId === null) {
      for (const folder of this.folders) {
        if (folder.pinned !== this.drag.pinned) continue;
        candidates.push({
          id: folder.id,
          order: folder.order,
          el: this.renderRoot.querySelector<HTMLElement>(
            `[data-folder-id="${folder.id}"]`,
          ),
        });
      }
    }

    candidates.sort((a, b) => a.order - b.order);

    for (const candidate of candidates) {
      if (!candidate.el) continue;
      const rect = candidate.el.getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;
      if (clientY < midpoint) return candidate.id;
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Render helpers
  // -------------------------------------------------------------------------

  private renderFileItem(file: NumeraFile, indented: boolean) {
    const isSelected = file.id === this.selectedId;
    const isDragging = file.id === this.draggingId;
    const isDropBefore = file.id === this.dropBeforeId;

    const classes = [
      indented ? 'child-file' : '',
      isDragging ? 'dragging' : '',
      isDropBefore ? 'drop-before' : '',
    ]
      .filter(Boolean)
      .join(' ');

    return html`
      <md-list-item
        type="button"
        class=${classes}
        data-file-id=${file.id}
        ?selected=${isSelected}
        aria-selected=${isSelected}
        @click=${() => this.dispatchSelect(file.id)}
      >
        <md-icon
          class="drag-handle"
          slot="start"
          aria-hidden="true"
          title="Drag to reorder"
          @pointerdown=${(event: PointerEvent) =>
            this.handleDragPointerDown(event, file)}
        >${ICONS.file}</md-icon>
        <div slot="headline">${file.displayName}</div>
        <span class="item-actions" slot="end">
          ${file.pinned
            ? html`
                <md-icon-button
                  class="pin-button"
                  aria-label="Unpin file"
                  title="Unpin"
                  @click=${(event: Event) => {
                    event.stopPropagation();
                    this.dispatchPin(file.id);
                  }}
                >
                  <md-icon>${ICONS.pin}</md-icon>
                </md-icon-button>
              `
            : null}
          <span class="overflow-anchor">
            <md-icon-button
              id=${`file-menu-btn-${file.id}`}
              aria-label="File actions"
              title="More actions"
              @click=${(event: Event) => {
                event.stopPropagation();
                this.openMenu(`file-menu-${file.id}`);
              }}
            >
              <md-icon>${ICONS.moreVert}</md-icon>
            </md-icon-button>
            <md-menu
              id=${`file-menu-${file.id}`}
              anchor=${`file-menu-btn-${file.id}`}
              anchor-corner="end-end"
              menu-corner="end-start"
              positioning="popover"
            >
              <md-menu-item
                @click=${(event: Event) => {
                  event.stopPropagation();
                  this.openRenameDialog({ id: file.id, name: file.displayName, kind: 'file' });
                }}
              >
                <div slot="headline">Rename</div>
              </md-menu-item>
              <md-menu-item
                @click=${(event: Event) => {
                  event.stopPropagation();
                  this.openMoveDialog(file);
                }}
              >
                <div slot="headline">Move to folder</div>
              </md-menu-item>
              <md-menu-item
                @click=${(event: Event) => {
                  event.stopPropagation();
                  this.dispatchExport(file.id);
                }}
              >
                <div slot="headline">Export</div>
              </md-menu-item>
              <md-menu-item
                @click=${(event: Event) => {
                  event.stopPropagation();
                  this.dispatchPin(file.id);
                }}
              >
                <div slot="headline">${file.pinned ? 'Unpin' : 'Pin'}</div>
              </md-menu-item>
              <md-menu-item
                @click=${(event: Event) => {
                  event.stopPropagation();
                  this.openDeleteDialog({ id: file.id, name: file.displayName, kind: 'file' });
                }}
              >
                <div slot="headline">Delete</div>
              </md-menu-item>
            </md-menu>
          </span>
        </span>
      </md-list-item>
    `;
  }

  private renderFolderItem(folder: NumeraFolder) {
    const isDropTarget = folder.id === this.dropFolderId;
    const isDropBefore = folder.id === this.dropBeforeId;
    const classes = [
      isDropTarget ? 'drop-into' : '',
      isDropBefore ? 'drop-before' : '',
    ]
      .filter(Boolean)
      .join(' ');
    return html`
      <md-list-item
        type="button"
        class=${classes}
        data-folder-id=${folder.id}
        @click=${() => this.dispatchFolderToggle(folder.id)}
      >
        <md-icon slot="start">${folder.collapsed ? ICONS.chevronRight : ICONS.expandMore}</md-icon>
        <md-icon class="folder-icon" slot="start">${ICONS.folder}</md-icon>
        <div slot="headline" class="folder-name">${folder.name}</div>
        <span class="item-actions" slot="end">
          ${folder.pinned
            ? html`
                <md-icon-button
                  class="pin-button"
                  aria-label="Unpin folder"
                  title="Unpin"
                  @click=${(event: Event) => {
                    event.stopPropagation();
                    this.dispatchFolderPin(folder.id);
                  }}
                >
                  <md-icon>${ICONS.pin}</md-icon>
                </md-icon-button>
              `
            : null}
          <span class="overflow-anchor">
            <md-icon-button
              id=${`folder-menu-btn-${folder.id}`}
              aria-label="Folder actions"
              title="More actions"
              @click=${(event: Event) => {
                event.stopPropagation();
                this.openMenu(`folder-menu-${folder.id}`);
              }}
            >
              <md-icon>${ICONS.moreVert}</md-icon>
            </md-icon-button>
            <md-menu
              id=${`folder-menu-${folder.id}`}
              anchor=${`folder-menu-btn-${folder.id}`}
              anchor-corner="end-end"
              menu-corner="end-start"
              positioning="popover"
            >
              <md-menu-item
                @click=${(event: Event) => {
                  event.stopPropagation();
                  this.openRenameDialog({ id: folder.id, name: folder.name, kind: 'folder' });
                }}
              >
                <div slot="headline">Rename</div>
              </md-menu-item>
              <md-menu-item
                @click=${(event: Event) => {
                  event.stopPropagation();
                  this.dispatchFolderPin(folder.id);
                }}
              >
                <div slot="headline">${folder.pinned ? 'Unpin' : 'Pin'}</div>
              </md-menu-item>
              <md-menu-item
                @click=${(event: Event) => {
                  event.stopPropagation();
                  this.openDeleteDialog({ id: folder.id, name: folder.name, kind: 'folder' });
                }}
              >
                <div slot="headline">Delete</div>
              </md-menu-item>
            </md-menu>
          </span>
        </span>
      </md-list-item>
    `;
  }

  private renderRenameDialog() {
    return html`
      <md-dialog ?open=${this.renameOpen} @closed=${this.closeRenameDialog}>
        <div slot="headline">${this.renameTarget?.kind === 'folder' ? 'Rename folder' : 'Rename file'}</div>
        <div slot="content">
          <md-filled-text-field
            id="rename-input"
            label="Name"
            .value=${this.renameTarget?.name ?? ''}
            @keydown=${this.handleRenameKeydown}
          ></md-filled-text-field>
        </div>
        <div slot="actions">
          <md-text-button @click=${this.closeRenameDialog}>Cancel</md-text-button>
          <md-text-button @click=${this.confirmRename}>Rename</md-text-button>
        </div>
      </md-dialog>
    `;
  }

  private renderCreateFolderDialog() {
    return html`
      <md-dialog ?open=${this.createFolderOpen} @closed=${this.closeCreateFolderDialog}>
        <div slot="headline">New folder</div>
        <div slot="content">
          <md-filled-text-field
            id="create-folder-input"
            label="Folder name"
            .value=${this.createFolderName}
            @input=${this.handleCreateFolderInput}
            @keydown=${this.handleCreateFolderKeydown}
          ></md-filled-text-field>
        </div>
        <div slot="actions">
          <md-text-button @click=${this.closeCreateFolderDialog}>Cancel</md-text-button>
          <md-text-button @click=${this.confirmCreateFolder}>Create</md-text-button>
        </div>
      </md-dialog>
    `;
  }

  private renderDeleteDialog() {
    const target = this.deleteTarget;
    return html`
      <md-dialog ?open=${this.deleteOpen} @closed=${this.closeDeleteDialog}>
        <div slot="headline">Delete ${target?.kind === 'folder' ? 'folder' : 'file'}</div>
        <div slot="content">
          ${target?.kind === 'folder'
            ? html`Are you sure you want to delete “${target.name}”? Its files will be moved to the root.`
            : html`Are you sure you want to delete “${target?.name}”?`}
        </div>
        <div slot="actions">
          <md-text-button @click=${this.closeDeleteDialog}>Cancel</md-text-button>
          <md-text-button @click=${this.confirmDelete}>Delete</md-text-button>
        </div>
      </md-dialog>
    `;
  }

  private renderMoveDialog() {
    const currentFolderId = this.moveTarget?.folderId ?? null;
    const sortedFolders = [...this.folders].sort(
      (a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || a.order - b.order,
    );
    return html`
      <md-dialog ?open=${this.moveOpen} @closed=${this.closeMoveDialog}>
        <div slot="headline">Move to folder</div>
        <div slot="content">
          <md-list class="move-dialog-list">
            <md-list-item type="button" @click=${() => this.moveFileTo(null)}>
              <md-icon slot="start">${ICONS.file}</md-icon>
              <div slot="headline">No folder</div>
              ${currentFolderId === null ? html`<md-icon slot="end">${ICONS.check}</md-icon>` : null}
            </md-list-item>
            ${sortedFolders.map(
              (folder) => html`
                <md-list-item type="button" @click=${() => this.moveFileTo(folder.id)}>
                  <md-icon slot="start">${ICONS.folder}</md-icon>
                  <div slot="headline">${folder.name}</div>
                  ${currentFolderId === folder.id ? html`<md-icon slot="end">${ICONS.check}</md-icon>` : null}
                </md-list-item>
              `,
            )}
            <md-list-item type="button" @click=${this.openCreateFolderFromMove}>
              <md-icon slot="start">${ICONS.newFolder}</md-icon>
              <div slot="headline">New folder…</div>
            </md-list-item>
          </md-list>
        </div>
        <div slot="actions">
          <md-text-button @click=${this.closeMoveDialog}>Cancel</md-text-button>
        </div>
      </md-dialog>
    `;
  }

  render() {
    const isEmpty = this.files.length === 0 && this.folders.length === 0;

    return html`
      ${this.dropToRoot
        ? html`
            <div class="drop-to-root">
              <md-icon>${ICONS.upArrow}</md-icon>
              <span>Move to root</span>
            </div>
          `
        : null}
      <div class="header">
        <div class="header-start">
          <md-icon-button
            class="collapse-button"
            aria-label="Toggle sidebar"
            title="Toggle sidebar"
            @click=${this.dispatchCollapseToggle}
          >
            <md-icon>${ICONS.menu}</md-icon>
          </md-icon-button>
          <div class="brand">Numera</div>
        </div>
        <div class="header-actions">
          <md-icon-button
            aria-label="New folder"
            title="New folder"
            @click=${() => this.openCreateFolderDialog()}
          >
            <md-icon>${ICONS.newFolder}</md-icon>
          </md-icon-button>
          <md-icon-button
            aria-label="Settings"
            title="Settings"
            @click=${this.dispatchSettingsOpen}
          >
            <md-icon>${ICONS.settings}</md-icon>
          </md-icon-button>
          <md-icon-button
            aria-label="Toggle theme"
            title="Toggle theme"
            @click=${this.dispatchThemeToggle}
          >
            <md-icon>${ICONS.theme}</md-icon>
          </md-icon-button>
        </div>
      </div>

      <md-list class="file-list">
        ${isEmpty
          ? html`
              <div class="empty-state">
                <div class="empty-state-title">No files yet</div>
                <div class="empty-state-body">
                  Your .numr files will appear here once your workspace is connected.
                </div>
              </div>
            `
          : this.scopeItems(null).map((item) =>
              item.kind === 'folder'
                ? html`
                    ${this.renderFolderItem(item.folder)}
                    ${item.folder.collapsed
                      ? null
                      : html`
                          <div
                            class="folder-children"
                            data-folder-children=${item.folder.id}
                          >
                            ${this.filesInFolder(item.folder.id).map((file) =>
                              this.renderFileItem(file, true),
                            )}
                          </div>
                        `}
                  `
                : this.renderFileItem(item.file, false),
            )}
      </md-list>

      ${this.renderRenameDialog()}
      ${this.renderCreateFolderDialog()}
      ${this.renderDeleteDialog()}
      ${this.renderMoveDialog()}
    `;
  }
}
