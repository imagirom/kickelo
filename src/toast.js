// src/toast.js
// Lightweight toast notification system replacing native alert() calls.

let container = null;

function ensureContainer() {
    if (container) return container;
    container = document.createElement('div');
    container.id = 'toastContainer';
    document.body.appendChild(container);
    return container;
}

/**
 * Show a toast notification.
 * @param {string} message - The text to display.
 * @param {'info'|'success'|'error'|'warning'} [type='info'] - Visual style.
 * @param {number} [durationMs=3000] - How long the toast stays visible.
 * @param {Function} [onClick] - Extra action run when the toast is clicked (before dismiss).
 */
export function showToast(message, type = 'info', durationMs = 3000, onClick = null) {
    const wrap = ensureContainer();

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    const icons = { info: 'ℹ️', success: '✅', error: '❌', warning: '⚠️' };
    toast.innerHTML = `<span class="toast-icon">${icons[type] || ''}</span><span class="toast-message">${escapeHtml(message)}</span>`;

    wrap.appendChild(toast);

    // Trigger entrance animation on next frame
    requestAnimationFrame(() => {
        toast.classList.add('toast-visible');
    });

    const dismiss = () => {
        toast.classList.remove('toast-visible');
        toast.addEventListener('transitionend', () => toast.remove(), { once: true });
        // Fallback removal in case transitionend doesn't fire
        setTimeout(() => toast.remove(), 400);
    };

    const timer = setTimeout(dismiss, durationMs);
    toast.addEventListener('click', () => {
        if (onClick) onClick();
        clearTimeout(timer);
        dismiss();
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Show a styled confirmation dialog (replaces native confirm()).
 * Returns a Promise that resolves to true (confirm) or false (cancel).
 * @param {string} message - The question / message text.
 * @param {object} [options]
 * @param {string} [options.confirmLabel='Confirm'] - Text for the confirm button.
 * @param {string} [options.cancelLabel='Cancel']   - Text for the cancel button.
 * @param {'info'|'warning'} [options.type='info']  - Visual accent.
 */
export function showConfirm(message, options = {}) {
    const {
        confirmLabel = 'Confirm',
        cancelLabel = 'Cancel',
        type = 'info',
        contentElement = null,
    } = options;

    return new Promise((resolve) => {
        // Backdrop
        const backdrop = document.createElement('div');
        backdrop.className = 'confirm-backdrop';

        // Dialog box
        const dialog = document.createElement('div');
        dialog.className = `confirm-dialog confirm-${type}`;

        // Message — convert \n to <br> for multi-line messages
        const msg = document.createElement('div');
        msg.className = 'confirm-message';
        msg.innerHTML = escapeHtml(message).replace(/\n/g, '<br>');

        // Buttons
        const btnRow = document.createElement('div');
        btnRow.className = 'confirm-buttons';

        const btnCancel = document.createElement('button');
        btnCancel.className = 'confirm-btn confirm-btn-cancel';
        btnCancel.textContent = cancelLabel;

        const btnConfirm = document.createElement('button');
        btnConfirm.className = 'confirm-btn confirm-btn-ok';
        btnConfirm.textContent = confirmLabel;

        btnRow.appendChild(btnCancel);
        btnRow.appendChild(btnConfirm);

        // Scrollable body for message + optional content
        const scrollBody = document.createElement('div');
        scrollBody.className = 'confirm-scroll-body';
        scrollBody.appendChild(msg);
        if (contentElement instanceof HTMLElement) {
            scrollBody.appendChild(contentElement);
        }
        dialog.appendChild(scrollBody);
        dialog.appendChild(btnRow);
        backdrop.appendChild(dialog);
        document.body.appendChild(backdrop);

        // Animate in
        requestAnimationFrame(() => backdrop.classList.add('confirm-visible'));

        const close = (result) => {
            backdrop.classList.remove('confirm-visible');
            backdrop.addEventListener('transitionend', () => backdrop.remove(), { once: true });
            setTimeout(() => backdrop.remove(), 350); // fallback
            resolve(result);
        };

        btnConfirm.addEventListener('click', () => close(true));
        btnCancel.addEventListener('click', () => close(false));
        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) close(false);
        });

        // Focus the confirm button for keyboard accessibility
        requestAnimationFrame(() => btnConfirm.focus());
    });
}
