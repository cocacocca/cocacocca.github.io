import * as THREE from 'https://esm.sh/three@0.150.1';
import { GPUComputationRenderer } from 'https://esm.sh/three@0.150.1/examples/jsm/misc/GPUComputationRenderer.js';
import { EffectComposer } from 'https://esm.sh/three@0.150.1/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'https://esm.sh/three@0.150.1/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'https://esm.sh/three@0.150.1/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'https://esm.sh/three@0.150.1/examples/jsm/postprocessing/ShaderPass.js';

// --- Scene Initialization ---
const container = document.createElement('div');
document.body.appendChild(container);
container.id = "canvas-container";

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x001105, 0.05);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.z = 25;

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);

// --- Post Processing Stack ---
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
bloomPass.threshold = 0.1;
bloomPass.strength = 1.2;
bloomPass.radius = 0.5;
composer.addPass(bloomPass);

const RGBShiftShader = {
    uniforms: {
        tDiffuse: { value: null },
        amount: { value: 0.002 },
        angle: { value: 0.0 }
    },
    vertexShader: `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: `
        uniform sampler2D tDiffuse; uniform float amount; uniform float angle; varying vec2 vUv;
        void main() {
            vec2 offset = amount * vec2( cos(angle), sin(angle));
            vec4 cr = texture2D(tDiffuse, vUv + offset);
            vec4 cga = texture2D(tDiffuse, vUv);
            vec4 cb = texture2D(tDiffuse, vUv - offset);
            gl_FragColor = vec4(cr.r, cga.g, cb.b, cga.a);
        }
    `
};
const rgbPass = new ShaderPass(RGBShiftShader);
composer.addPass(rgbPass);

// --- Text Attractor Map Generator ---
const WIDTH = 256; 
const PARTICLES = WIDTH * WIDTH;

function generateTextAttractors(text) {
    const canvas = document.createElement('canvas');
    canvas.width = 1024; canvas.height = 512;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 130px monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);

    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const positions = new Float32Array(PARTICLES * 4);
    
    let pIdx = 0;
    for (let y = 0; y < canvas.height; y += 2) {
        for (let x = 0; x < canvas.width; x += 2) {
            if (imgData[(y * canvas.width + x) * 4] > 128) {
                positions[pIdx * 4] = (x - canvas.width / 2) * 0.035;
                positions[pIdx * 4 + 1] = -(y - canvas.height / 2) * 0.035;
                positions[pIdx * 4 + 2] = (Math.random() - 0.5) * 2.0;
                positions[pIdx * 4 + 3] = 1.0;
                pIdx++;
                if(pIdx >= PARTICLES) break;
            }
        }
    }
    for(let i = pIdx; i < PARTICLES; i++) {
        positions[i * 4] = (Math.random() - 0.5) * 50;
        positions[i * 4 + 1] = (Math.random() - 0.5) * 50;
        positions[i * 4 + 2] = (Math.random() - 0.5) * 50;
        positions[i * 4 + 3] = 1.0;
    }
    return positions;
}

// --- GPGPU Setup ---
const gpuCompute = new GPUComputationRenderer(WIDTH, WIDTH, renderer);
const dtPosition = gpuCompute.createTexture();
const dtVelocity = gpuCompute.createTexture();
const dtTarget = gpuCompute.createTexture();

const initialAttractors = generateTextAttractors("cocacocca");

for (let i = 0; i < PARTICLES; i++) {
    dtPosition.image.data[i * 4] = (Math.random() - 0.5) * 60;
    dtPosition.image.data[i * 4 + 1] = (Math.random() - 0.5) * 60;
    dtPosition.image.data[i * 4 + 2] = (Math.random() - 0.5) * 60;
    dtPosition.image.data[i * 4 + 3] = 1.0;
    
    dtVelocity.image.data[i * 4] = 0;
    dtVelocity.image.data[i * 4 + 1] = 0;
    dtVelocity.image.data[i * 4 + 2] = 0;
    dtVelocity.image.data[i * 4 + 3] = 1.0;

    dtTarget.image.data[i * 4] = initialAttractors[i * 4];
    dtTarget.image.data[i * 4 + 1] = initialAttractors[i * 4 + 1];
    dtTarget.image.data[i * 4 + 2] = initialAttractors[i * 4 + 2];
    dtTarget.image.data[i * 4 + 3] = 1.0;
}

const posVar = gpuCompute.addVariable("texturePosition", document.getElementById('compute-position').textContent, dtPosition);
const velVar = gpuCompute.addVariable("textureVelocity", document.getElementById('compute-velocity').textContent, dtVelocity);

gpuCompute.setVariableDependencies(posVar, [posVar, velVar]);
gpuCompute.setVariableDependencies(velVar, [posVar, velVar]);

velVar.material.uniforms.time = { value: 0.0 };
velVar.material.uniforms.chaos = { value: 0.0 };
velVar.material.uniforms.mouse = { value: new THREE.Vector3(0, 0, 0) };
velVar.material.uniforms.textureTarget = { value: dtTarget };

gpuCompute.init();

// --- Particle Rendering System ---
const geometry = new THREE.BufferGeometry();
const uvs = new Float32Array(PARTICLES * 2);
for (let j = 0; j < WIDTH; j++) {
    for (let i = 0; i < WIDTH; i++) {
        uvs[(j * WIDTH + i) * 2] = i / (WIDTH - 1);
        uvs[(j * WIDTH + i) * 2 + 1] = j / (WIDTH - 1);
    }
}
geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

const material = new THREE.ShaderMaterial({
    uniforms: {
        texturePosition: { value: null }
    },
    vertexShader: `
        uniform sampler2D texturePosition;
        void main() {
            vec4 posData = texture2D(texturePosition, uv);
            vec4 mvPosition = modelViewMatrix * vec4(posData.xyz, 1.0);
            gl_PointSize = (4.0 / -mvPosition.z);
            gl_Position = projectionMatrix * mvPosition;
        }
    `,
    fragmentShader: `
        void main() {
            float dist = length(gl_PointCoord - vec2(0.5));
            if (dist > 0.5) discard;
            gl_FragColor = vec4(0.0, 1.0, 0.53, 1.0 - (dist * 2.0)); 
        }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
});

const particles = new THREE.Points(geometry, material);
scene.add(particles);

// --- Interactions & State Logic ---
const mouse = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

window.addEventListener('mousemove', (e) => {
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    
    raycaster.setFromCamera(mouse, camera);
    const target = new THREE.Vector3();
    raycaster.ray.intersectPlane(plane, target);
    velVar.material.uniforms.mouse.value.copy(target);
});

let targetChaos = 0.0;

document.querySelectorAll('nav a').forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        
        document.querySelectorAll('nav a, section').forEach(el => el.classList.remove('active'));
        e.target.classList.add('active');
        document.getElementById(e.target.dataset.target).classList.add('active');

        targetChaos = 1.0; 
        rgbPass.uniforms.amount.value = 0.02; 
        
        setTimeout(() => {
            const sectionTitles = {
                'identity': "cocacocca",
                'philosophy': "SYSTEM",
                'skills': "DATA",
                'projects': "MODELS"
            };
            const currentTargetText = sectionTitles[e.target.dataset.target];
            
            const newAttractors = generateTextAttractors(currentTargetText);
            const dtNewTarget = gpuCompute.createTexture();
            dtNewTarget.image.data.set(newAttractors);
            velVar.material.uniforms.textureTarget.value = dtNewTarget;
            
            targetChaos = 0.0; 
        }, 800);
    });
});

window.addEventListener('wheel', (e) => {
    if(e.deltaY < 0) { 
        camera.position.z -= 0.5;
        targetChaos = Math.min(1.0, targetChaos + 0.1);
    } else {
        camera.position.z += 0.5;
        targetChaos = Math.max(0.0, targetChaos - 0.1);
    }
    camera.position.z = THREE.MathUtils.clamp(camera.position.z, 2, 45);
});

// --- Main Loop ---
const clock = new THREE.Clock();
function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();
    const time = clock.getElapsedTime();

    velVar.material.uniforms.chaos.value = THREE.MathUtils.lerp(velVar.material.uniforms.chaos.value, targetChaos, delta * 2.0);
    rgbPass.uniforms.amount.value = THREE.MathUtils.lerp(rgbPass.uniforms.amount.value, 0.001, delta * 5.0);

    velVar.material.uniforms.time.value = time;
    
    gpuCompute.compute();
    material.uniforms.texturePosition.value = gpuCompute.getCurrentRenderTarget(posVar).texture;
    
    composer.render();
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
});

animate();