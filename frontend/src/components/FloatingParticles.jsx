import React, { useEffect, useRef } from 'react';

export default function FloatingParticles() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId;
    let particles = [];

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    class Particle {
      constructor() {
        this.x = Math.random() * canvas.width;
        this.y = Math.random() * canvas.height;
        this.size = Math.random() * 1.8 + 0.3;
        this.speedX = Math.random() * 0.2 - 0.1;
        this.speedY = Math.random() * -0.3 - 0.1; // Float upwards
        // Soft gold to soft blue hues
        this.color = Math.random() > 0.5 
          ? 'rgba(191, 149, 63, ' + (Math.random() * 0.25 + 0.05) + ')'  // Gold
          : 'rgba(56, 189, 248, ' + (Math.random() * 0.2 + 0.05) + ')'; // Light Blue
      }

      update() {
        this.x += this.speedX;
        this.y += this.speedY;

        // Wrap around boundaries
        if (this.x < 0 || this.x > canvas.width) this.speedX = -this.speedX;
        if (this.y < -10) {
          this.y = canvas.height + 10;
          this.x = Math.random() * canvas.width;
        }
      }

      draw() {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.fill();
      }
    }

    // Initialize particles
    const init = () => {
      particles = [];
      const particleCount = Math.floor((canvas.width * canvas.height) / 18000);
      for (let i = 0; i < Math.min(particleCount, 80); i++) {
        particles.push(new Particle());
      }
    };

    init();

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Draw a subtle radial ambient glow in the center
      const gradient = ctx.createRadialGradient(
        canvas.width / 2, canvas.height / 2, 10,
        canvas.width / 2, canvas.height / 2, Math.max(canvas.width, canvas.height) / 1.5
      );
      gradient.addColorStop(0, 'rgba(15, 23, 42, 0.4)');
      gradient.addColorStop(1, 'rgba(2, 6, 23, 0.9)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      particles.forEach((particle) => {
        particle.update();
        particle.draw();
      });

      animationFrameId = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none z-0"
      style={{ mixBlendMode: 'screen' }}
    />
  );
}
