// Aurora Stack - GitHub Pages JavaScript

// Smooth scroll for anchor links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
    e.preventDefault();
    const target = document.querySelector(this.getAttribute('href'));
    if (target) {
      target.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    }
  });
});

// Add active state to nav links on scroll
const sections = document.querySelectorAll('section[id]');
const navLinks = document.querySelectorAll('.nav-links a[href^="#"]');

function setActiveNav() {
  const scrollY = window.pageYOffset;

  sections.forEach(section => {
    const sectionHeight = section.offsetHeight;
    const sectionTop = section.offsetTop - 100;
    const sectionId = section.getAttribute('id');

    if (scrollY > sectionTop && scrollY <= sectionTop + sectionHeight) {
      navLinks.forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('href') === `#${sectionId}`) {
          link.style.textShadow = '0 0 8px rgba(0, 245, 212, 0.6)';
        } else {
          link.style.textShadow = 'none';
        }
      });
    }
  });
}

window.addEventListener('scroll', setActiveNav);

// Add fade-in animation to elements on scroll
const observerOptions = {
  threshold: 0.1,
  rootMargin: '0px 0px -50px 0px'
};

const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.style.opacity = '1';
      entry.target.style.transform = 'translateY(0)';
    }
  });
}, observerOptions);

// Observe feature cards, doc cards, and steps
document.querySelectorAll('.feature-card, .doc-card, .step, .stat-card').forEach(el => {
  el.style.opacity = '0';
  el.style.transform = 'translateY(20px)';
  el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
  observer.observe(el);
});

// Add copy button to code blocks
document.querySelectorAll('pre code').forEach(block => {
  const pre = block.parentElement;
  const button = document.createElement('button');
  button.className = 'copy-button';
  button.innerHTML = '📋 Copy';
  button.style.cssText = `
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    background: rgba(0, 245, 212, 0.2);
    border: 1px solid rgba(0, 245, 212, 0.5);
    color: #00F5D4;
    padding: 0.5rem 1rem;
    border-radius: 0.375rem;
    cursor: pointer;
    font-size: 0.875rem;
    transition: all 0.2s ease;
  `;

  pre.style.position = 'relative';
  pre.appendChild(button);

  button.addEventListener('click', async () => {
    const code = block.textContent;
    try {
      await navigator.clipboard.writeText(code);
      button.innerHTML = '✓ Copied!';
      button.style.background = 'rgba(154, 239, 130, 0.2)';
      button.style.borderColor = 'rgba(154, 239, 130, 0.5)';
      button.style.color = '#9AEF82';

      setTimeout(() => {
        button.innerHTML = '📋 Copy';
        button.style.background = 'rgba(0, 245, 212, 0.2)';
        button.style.borderColor = 'rgba(0, 245, 212, 0.5)';
        button.style.color = '#00F5D4';
      }, 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  });

  button.addEventListener('mouseenter', () => {
    button.style.background = 'rgba(0, 245, 212, 0.3)';
    button.style.boxShadow = '0 0 12px 2px rgba(0, 245, 212, 0.5)';
  });

  button.addEventListener('mouseleave', () => {
    if (button.innerHTML === '📋 Copy') {
      button.style.background = 'rgba(0, 245, 212, 0.2)';
      button.style.boxShadow = 'none';
    }
  });
});

console.log('%cPublicAppView 🌌', 'color: #00F5D4; font-size: 24px; font-weight: bold;');
console.log('%cBuilt with Aurora Stack', 'color: #9AEF82; font-size: 14px;');
