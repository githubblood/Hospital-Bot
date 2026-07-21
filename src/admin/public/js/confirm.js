// Styled stand-in for window.confirm(), built from the same
// .modal-overlay/.modal-box markup already used for the logout confirm on
// every admin page — so it matches the app's own look instead of the
// browser's native dialog chrome. Usage: const ok = await Confirm.show('...',
// { title, confirmText, cancelText, danger }); resolves true/false, never
// throws/blocks like window.confirm did.
const Confirm = (function () {
    function show(message, opts = {}) {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'modal-overlay show';

            const box = document.createElement('div');
            box.className = 'modal-box';

            const h3 = document.createElement('h3');
            h3.textContent = opts.title || 'Please Confirm';

            const p = document.createElement('p');
            p.textContent = message;

            const actions = document.createElement('div');
            actions.className = 'modal-actions';

            const cancelBtn = document.createElement('button');
            cancelBtn.type = 'button';
            cancelBtn.className = 'btn btn-outline';
            cancelBtn.textContent = opts.cancelText || 'Cancel';

            const okBtn = document.createElement('button');
            okBtn.type = 'button';
            okBtn.className = 'btn ' + (opts.danger ? 'btn-danger' : 'btn-primary');
            okBtn.textContent = opts.confirmText || 'Confirm';

            actions.appendChild(cancelBtn);
            actions.appendChild(okBtn);
            box.appendChild(h3);
            box.appendChild(p);
            box.appendChild(actions);
            overlay.appendChild(box);
            document.body.appendChild(overlay);

            function cleanup(result) {
                document.removeEventListener('keydown', onKey);
                overlay.remove();
                resolve(result);
            }
            function onKey(e) {
                if (e.key === 'Escape') cleanup(false);
            }

            cancelBtn.addEventListener('click', () => cleanup(false));
            okBtn.addEventListener('click', () => cleanup(true));
            overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(false); });
            document.addEventListener('keydown', onKey);
            okBtn.focus();
        });
    }

    // Styled stand-in for window.prompt(). Resolves the trimmed input value,
    // or null on cancel/backdrop/Escape — same contract as window.prompt.
    function prompt(message, opts = {}) {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'modal-overlay show';

            const box = document.createElement('div');
            box.className = 'modal-box';

            const h3 = document.createElement('h3');
            h3.textContent = opts.title || 'Please provide details';

            const p = document.createElement('p');
            p.textContent = message;
            p.style.marginBottom = '0.6rem';

            const input = document.createElement('textarea');
            input.className = 'confirm-prompt-input';
            input.rows = 2;
            input.placeholder = opts.placeholder || '';

            const actions = document.createElement('div');
            actions.className = 'modal-actions';

            const cancelBtn = document.createElement('button');
            cancelBtn.type = 'button';
            cancelBtn.className = 'btn btn-outline';
            cancelBtn.textContent = opts.cancelText || 'Cancel';

            const okBtn = document.createElement('button');
            okBtn.type = 'button';
            okBtn.className = 'btn btn-primary';
            okBtn.textContent = opts.confirmText || 'Submit';

            actions.appendChild(cancelBtn);
            actions.appendChild(okBtn);
            box.appendChild(h3);
            box.appendChild(p);
            box.appendChild(input);
            box.appendChild(actions);
            overlay.appendChild(box);
            document.body.appendChild(overlay);

            function cleanup(result) {
                document.removeEventListener('keydown', onKey);
                overlay.remove();
                resolve(result);
            }
            function onKey(e) {
                if (e.key === 'Escape') cleanup(null);
            }

            cancelBtn.addEventListener('click', () => cleanup(null));
            okBtn.addEventListener('click', () => cleanup(input.value.trim() || null));
            overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(null); });
            document.addEventListener('keydown', onKey);
            input.focus();
        });
    }

    return { show, prompt };
})();
