/**
 * GitHub Issue Scraper - Client-side JavaScript
 */

document.addEventListener('DOMContentLoaded', function() {
    // Initialize Markdown renderer with custom options
    if (typeof marked !== 'undefined') {
        marked.setOptions({
            breaks: true,           // Add line breaks in source as <br>
            gfm: true,              // GitHub Flavored Markdown
            headerIds: true,        // Include IDs in headings
            highlight: function(code, lang) {
                if (Prism && Prism.highlight && lang && Prism.languages[lang]) {
                    return Prism.highlight(code, Prism.languages[lang], lang);
                }
                return code;
            }
        });
    }
    
    // Handle form submission - prevent multiple submissions
    const scrapeForm = document.querySelector('form[action="/scrape"]');
    if (scrapeForm) {
        scrapeForm.addEventListener('submit', function(e) {
            const submitButton = this.querySelector('button[type="submit"]');
            if (submitButton) {
                submitButton.disabled = true;
                submitButton.innerHTML = '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Scraping...';
            }
        });
    }
    
    // Handle filter reset button
    const resetFiltersBtn = document.getElementById('resetFilters');
    if (resetFiltersBtn) {
        resetFiltersBtn.addEventListener('click', function() {
            const stateFilter = document.getElementById('stateFilter');
            const labelFilter = document.getElementById('labelFilter');
            const searchFilter = document.getElementById('searchFilter');
            
            if (stateFilter) stateFilter.value = 'all';
            if (labelFilter) labelFilter.value = '';
            if (searchFilter) searchFilter.value = '';
            
            // Trigger the filter application
            const event = new Event('change');
            if (stateFilter) stateFilter.dispatchEvent(event);
        });
    }
    
    // Initialize tooltips if Bootstrap is available
    if (typeof bootstrap !== 'undefined' && bootstrap.Tooltip) {
        const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
        tooltipTriggerList.map(function (tooltipTriggerEl) {
            return new bootstrap.Tooltip(tooltipTriggerEl);
        });
    }
}); 