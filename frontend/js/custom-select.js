// Wraps a <select> with a styled, self-contained dropdown panel so a long
// option list doesn't rely on the browser's native popup — that popup is an
// OS-level layer that ignores z-index and floats above every other element
// on the page (including unrelated cards further down the form) regardless
// of how it's styled. The original <select> stays in the DOM (visually
// hidden, still the source of truth), so existing code that reads/writes
// `.value` or listens for `change` keeps working unchanged.
const CustomSelect = (function () {
    function closePanel(select) {
        const wrap = select.closest('.custom-select');
        if (!wrap) return;
        wrap.querySelector('.custom-select-panel')?.classList.remove('open');
        wrap.querySelector('.custom-select-trigger')?.classList.remove('open');
    }

    function renderOptions(select, panel) {
        panel.innerHTML = '';
        Array.from(select.options).forEach(opt => {
            const item = document.createElement('div');
            item.className = 'custom-select-option' + (opt.value === select.value ? ' selected' : '');
            item.textContent = opt.textContent;
            item.dataset.value = opt.value;
            item.addEventListener('click', () => {
                if (select.value !== opt.value) {
                    select.value = opt.value;
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                }
                closePanel(select);
            });
            panel.appendChild(item);
        });
    }

    function openPanel(select) {
        const wrap = select.closest('.custom-select');
        if (!wrap) return;
        const panel = wrap.querySelector('.custom-select-panel');
        renderOptions(select, panel);
        panel.classList.add('open');
        wrap.querySelector('.custom-select-trigger')?.classList.add('open');
    }

    // Keeps the trigger button's label (and the panel's selected highlight,
    // next time it opens) in sync with the underlying <select>. Call this
    // after setting select.value programmatically — that doesn't fire
    // 'change' on its own, so nothing else re-syncs the trigger for you.
    function sync(select) {
        const wrap = select.closest('.custom-select');
        if (!wrap) return;
        const trigger = wrap.querySelector('.custom-select-trigger');
        const opt = select.options[select.selectedIndex];
        trigger.textContent = opt ? opt.textContent : '';
    }

    function mount(select) {
        if (select.dataset.customSelectMounted) { sync(select); return; }
        select.dataset.customSelectMounted = '1';

        const wrap = document.createElement('div');
        wrap.className = 'custom-select';
        select.parentNode.insertBefore(wrap, select);
        wrap.appendChild(select);
        select.classList.add('custom-select-native');
        select.tabIndex = -1;

        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'custom-select-trigger';
        wrap.appendChild(trigger);

        const panel = document.createElement('div');
        panel.className = 'custom-select-panel';
        wrap.appendChild(panel);

        trigger.addEventListener('click', () => {
            panel.classList.contains('open') ? closePanel(select) : openPanel(select);
        });
        document.addEventListener('click', (e) => {
            if (!wrap.contains(e.target)) closePanel(select);
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closePanel(select);
        });
        select.addEventListener('change', () => sync(select));

        sync(select);
    }

    return { mount, sync };
})();
