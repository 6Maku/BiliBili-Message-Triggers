class ActivityMeter extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });

        this.imagePath = '';
        this.soundPath = '';
        
        this.volume = 0.1;

        // Bar state
        this.currentLevel = 0;
        this.targetLevel = 0.7;

        this.tiggerCooldown= 5.0;
        this.lastTriggered= 0;

        // Decay configuration (slower fall)
        this.decayRate = 0.1;  // Units per second decay
        this.decayDelay = 2000; // ms before decay starts after last add
        this.lastAddTime = 0;
        this.isDecaying = false;

        // Message tracking for rate-based addition
        this.messageHistory = []; // Timestamps of tracked messages
        this.windowSize = 5000;   // 5 second window for rate calculation
        this.baseAddAmount = 0.5; // Base amount to add per message

        // Spam detection
        this.trackedWord = 'test';
        this.rateThreshold = 2.0; // messages per second to be considered "spam"
        this.spamMultiplier = 2.0; // Extra fill when spamming

        // Cooldown to prevent bar going too high too fast
        this.maxAddPerSecond = 0.5;
        this.recentAdds = []; // Track recent additions for rate limiting

        this.injectGlobalStyles();

        this.render();
        this.startLoop();
    }

    init(phrase, imagePath, soundPath) {
        this.trackedWord = phrase;
        this.imagePath = imagePath;
        this.soundPath = soundPath;

        return this;
    }

    injectGlobalStyles() {
        // Only add once to document head
        if (document.getElementById('activity-meter-global-styles')) return;
        
        const style = document.createElement('style');
        style.id = 'activity-meter-global-styles';
        style.textContent = `
            .activity-effect-overlay {
                position: fixed;
                top: 0;
                left: 0;
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 99999;
                pointer-events: none;
            }
            .activity-effect-overlay img {
                width: 100vw;
                height: auto;
                object-fit: contain;
            }
            .activity-effect-overlay.activity-fade-out {
                animation: activityFadeOut 1.0s ease-out forwards !important;
            }
            @keyframes activityFadeOut {
                from { opacity: 1; }
                to { opacity: 0; }
            }
        `;
        document.head.appendChild(style);
    }


    // Add activity based on message rate
    addMessage(text) {
        const now = Date.now();

        // Record message
        this.messageHistory.push(now);
        

        // Clean old messages
        this.messageHistory = this.messageHistory.filter(t => now - t < this.windowSize);

        // Check if message contains tracked word (case insensitive)
        if (!text.toLowerCase().includes(this.trackedWord.toLowerCase())) {
            return; // Ignore non-tracked messages
        }

        // Calculate current rate (messages per second)
        const rate = this.messageHistory.length / (this.windowSize / 1000);

        // Calculate add amount based on rate
        // Higher rate = more fill per message (detecting spam/abnormal activity)
        let addAmount = this.baseAddAmount / this.messageHistory.length;

        if (rate > this.rateThreshold) {
            // Spam detected - scale up fill amount
            const spamFactor = Math.min((rate - this.rateThreshold) / 3, 2); // Cap at 3x
            addAmount *= (1 + spamFactor * this.spamMultiplier);
        }

        // Rate limit additions
        this.recentAdds = this.recentAdds.filter(t => now - t < 1000);
        if (this.recentAdds.length > 0) {
            const timeSinceLastAdd = now - this.recentAdds[this.recentAdds.length - 1];
            const minInterval = 1000 / (this.maxAddPerSecond / addAmount);
            if (timeSinceLastAdd < minInterval) {
                // Too fast, reduce amount
                addAmount *= 0.5;
            }
        }
        this.recentAdds.push(now);

        // Add to target (capped at 1.0)
        this.currentLevel = Math.min(1.0, this.currentLevel + addAmount);
        this.lastAddTime = now;
        this.isDecaying = false;

        // Debug logging
        const isSpam = rate > this.rateThreshold;
        console.log(`[Activity] "${text}" | Rate: ${rate.toFixed(2)}/s | Add: ${(addAmount * 100).toFixed(1)}% | Level: ${(this.currentLevel * 100).toFixed(0)}%${isSpam ? ' 🔥 SPAM' : ''}`);


        if (this.currentLevel > this.targetLevel && now - this.lastTriggered > this.tiggerCooldown * 1000) {
            this.lastTriggered = now;
            this.triggerEffect();
        }

        this.updateVisuals();
    }

    async triggerEffect() {
        if (this.imagePath) {
            const overlay = document.createElement('div');
            overlay.className = 'activity-effect-overlay';
            overlay.innerHTML = `<img src="${this.imagePath}" alt="effect">`;
            document.body.appendChild(overlay);
            
            // Fade out and remove after 3 seconds
            setTimeout(() => {
                overlay.classList.add('activity-fade-out');
                // Wait for animation to finish then remove from DOM
                setTimeout(() => {
                    if (overlay.parentNode) overlay.remove();
                }, 300); // Match animation duration
            }, 1500);
        }

        if (this.soundPath) {
            const audio = new Audio(this.soundPath);
            audio.volume = this.volume;
            await audio.play();
        }
    }

    // Physics loop - slow decay
    updatePhysics(dt) {
        const now = Date.now();

        // Check if we should start decaying
        if (!this.isDecaying && now - this.lastAddTime > this.decayDelay) {
            this.isDecaying = true;
        }

        // Apply decay
        if (this.isDecaying && this.currentLevel > 0) {
            this.currentLevel = Math.max(0, this.currentLevel - this.decayRate * dt);
            this.updateVisuals();
        }
    }

    updateVisuals() {
        const bar = this.shadowRoot.querySelector('.bar-fill');
        const percentage = Math.round(this.currentLevel * 100);
        const percentageText = this.shadowRoot.querySelector('.percentage');
        const rateDisplay = this.shadowRoot.querySelector('.rate-display');

        bar.style.width = `${percentage}%`;
        percentageText.textContent = `${percentage}%`;
        bar.setAttribute('data-level', percentage);

        // Calculate current rate for display
        const now = Date.now();
        const recentMessages = this.messageHistory.filter(t => now - t < this.windowSize);
        const rate = recentMessages.length / (this.windowSize / 1000);
        rateDisplay.textContent = `${rate.toFixed(1)}/s`;

        // Color coding based on level and rate
        if (this.currentLevel >= 0.8) {
            // Critical - intense rainbow
            const hue = (Date.now() / 5) % 360;
            bar.style.background = `linear-gradient(90deg, 
                hsl(${hue}, 100%, 50%), 
                hsl(${(hue + 120) % 360}, 100%, 50%)
            )`;
            bar.classList.add('rainbow');
        } else if (rate > this.rateThreshold) {
            // Spam detected - orange/red pulse
            const pulse = Math.sin(Date.now() / 100) * 0.5 + 0.5;
            bar.style.background = `linear-gradient(90deg, 
                hsl(${20 + pulse * 20}, 100%, 50%), 
                hsl(${0}, 100%, 60%)
            )`;
            bar.classList.remove('rainbow');
        } else if (this.currentLevel >= 0.5) {
            // Medium - purple/pink
            bar.style.background = `linear-gradient(90deg, 
                hsl(280, 80%, 50%) 0%, 
                hsl(340, 80%, 60%) 100%
            )`;
            bar.classList.remove('rainbow');
        } else {
            // Low - cool blue
            bar.style.background = `linear-gradient(90deg, 
                hsl(200, 80%, 50%) 0%, 
                hsl(260, 80%, 60%) 100%
            )`;
            bar.classList.remove('rainbow');
        }
    }

    startLoop() {
        let lastTime = performance.now();
        const loop = (now) => {
            const dt = Math.min((now - lastTime) / 1000, 0.1);
            lastTime = now;
            this.updatePhysics(dt);
            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    }

    render() {
        this.shadowRoot.innerHTML = `
            <style>
                :host {
                    display: block;
                    width: 100%;
                    margin-bottom: 10px;
                }
                .container {
                    background: rgba(0, 0, 0, 0.6);
                    border-radius: 12px;
                    padding: 12px;
                    backdrop-filter: blur(10px);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                }
                .label {
                    font-size: 12px;
                    color: #aaa;
                    text-transform: uppercase;
                    letter-spacing: 1px;
                    margin-bottom: 6px;
                    display: flex;
                    justify-content: space-between;
                }
                .bar-bg {
                    height: 20px;
                    background: rgba(255, 255, 255, 0.1);
                    border-radius: 10px;
                    overflow: hidden;
                    position: relative;
                }
                .bar-fill {
                    height: 100%;
                    width: 0%;
                    border-radius: 10px;
                    transition: width 0.05s ease-out;
                    background: linear-gradient(90deg, #4facfe 0%, #00f2fe 100%);
                    box-shadow: 0 0 20px rgba(79, 172, 254, 0.5);
                    position: relative;
                }
                .bar-fill.rainbow {
                    box-shadow: 0 0 30px rgba(255, 255, 255, 0.8);
                }
                .bar-fill::after {
                    content: '';
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: linear-gradient(90deg, 
                        transparent 0%, 
                        rgba(255,255,255,0.3) 50%, 
                        transparent 100%
                    );
                    animation: shimmer 2s infinite;
                }
                @keyframes shimmer {
                    0% { transform: translateX(-100%); }
                    100% { transform: translateX(100%); }
                }
                .percentage {
                    position: absolute;
                    right: 8px;
                    top: 50%;
                    transform: translateY(-50%);
                    font-size: 11px;
                    font-weight: bold;
                    color: white;
                    text-shadow: 0 1px 2px rgba(0,0,0,0.5);
                }                    
            </style>
            <div class="container">
                <div class="label">
                    <span>ACTIVITY METER</span>
                    <span class="rate-display"></span>
                </div>
                <div class="bar-bg">
                    <div class="bar-fill"></div>
                    <div class="percentage">0%</div>
                </div>
            </div>
        `;
    }
}

customElements.define('activity-meter', ActivityMeter);


function ActivityBar(phrase, imagePath, soundPath) {
    const el = document.createElement('activity-meter');
    // Wait for custom element to be defined, then init
    if (el.init) {
        el.init(phrase, imagePath, soundPath);
    } else {
        // Fallback if called before definition
        setTimeout(() => el.init(phrase, imagePath, soundPath), 0);
    }
    return el;
}