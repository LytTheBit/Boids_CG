import * as THREE from 'three';

/*
 * BirdGeometry.js
 *
 * Definisce la geometria visuale dei boids (farfalle).
 *
 * Ogni boid è rappresentato da 4 triangoli, tutti agganciati allo stesso
 * punto cardine sull'asse del corpo (x=0):
 * - ala superiore sinistra e destra (forewing, più grandi);
 * - ala inferiore sinistra e destra (hindwing, più piccole).
 *
 * Non c'è un corpo separato: le farfalle sono definite unicamente dalle
 * 4 ali, esattamente come nel riferimento fornito. La direzione di volo
 * coincide con il lato delle ali più grandi (forewing, verso +z).
 *
 * Ogni ala è un triangolo rettangolo con:
 * - il cardine, sull'asse del corpo (0,0,z_cardine);
 * - un "angolo" alla stessa profondità z del cardine, spostato solo in x;
 * - una "punta", alla stessa x dell'angolo, spostata in z (in avanti per
 *   la forewing, all'indietro per la hindwing).
 * L'angolo e la punta condividono la stessa x: questo fa sì che il bordo
 * esterno dell'ala (angolo-punta) resti un segmento rigido a distanza
 * costante dal cardine, propedeutico alla piegatura rigida nel vertex shader.
 *
 * La geometria contiene anche:
 * - reference: coordinate UV per leggere posizione e velocità dalla texture GPGPU;
 * - birdColor: colore del boid, assegnato in base alla specie con una leggera
 *   variazione casuale (tonalità/luminosità) per dare varietà visiva senza
 *   alterare le interazioni tra i boid (che dipendono solo dalla texture GPGPU).
 *
 * Le specie sono distribuite in modo il più possibile uniforme.
 * Esempio:
 * - 100 boids, 4 specie -> 25 boids per specie;
 * - 100 boids, 3 specie -> circa 34, 33, 33.
 */

const SPECIES_COLORS = [
    0xe53935, // rosso
    0xfdd835, // giallo
    0x1e88e5, // blu
    0x43a047, // verde
    0x8e24aa, // viola
    0xfb8c00, // arancione
    0xec407a, // rosa
    0x8d6e63  // marrone
];

export class BirdGeometry extends THREE.BufferGeometry {
    constructor(boidCount, textureWidth, speciesCount) {
        super();

        const trianglesPerBird = 4;
        const triangles = boidCount * trianglesPerBird;
        const points = triangles * 3;
        const vertsPerBird = trianglesPerBird * 3; // 12

        const vertices = new THREE.BufferAttribute(new Float32Array(points * 3), 3);
        const birdColors = new THREE.BufferAttribute(new Float32Array(points * 3), 3);
        const references = new THREE.BufferAttribute(new Float32Array(points * 2), 2);

        this.setAttribute('position', vertices);
        this.setAttribute('birdColor', birdColors);
        this.setAttribute('reference', references);

        let vertexArrayIndex = 0;

        function vertsPush(...values) {
            for (let i = 0; i < values.length; i++) {
                vertices.array[vertexArrayIndex++] = values[i];
            }
        }

        /*
         * Dimensioni delle ali, ricavate dal disegno di riferimento
         * (entrambe le ali sono triangoli rettangoli vicini ai 45°):
         * - forewing: gamba orizzontale (span) e gamba verticale (lunghezza
         *   in avanti) di dimensioni quasi uguali, circa 26-27 unità;
         * - hindwing: stesse proporzioni ma più piccola, circa il 72% della
         *   forewing.
         */
        const foreSpanX = 26;
        const foreForwardZ = 27;

        const hindSpanX = 19;
        const hindBackZ = 20;

        /*
         * Precalcoliamo un colore per ogni singolo boid partendo dal colore
         * della sua specie, con una leggera variazione casuale di tonalità,
         * saturazione e luminosità (spazio HSL). La variazione è puramente
         * estetica: la specie di appartenenza (e quindi le regole di
         * interazione nella simulazione GPGPU) resta invariata.
         *
         * Il jitter di saturazione è importante quanto quello di tonalità:
         * su un colore già desaturato (es. il grigio 0x333333 usato di
         * default quando c'è una sola specie), ruotare la tonalità non ha
         * alcun effetto visibile se non si varia anche la saturazione.
         */
        const boidColors = new Array(boidCount);
        for (let i = 0; i < boidCount; i++) {
            const speciesIndex = Math.floor(i * speciesCount / boidCount);
            const baseColor = new THREE.Color(SPECIES_COLORS[speciesIndex % SPECIES_COLORS.length]);

            const hsl = { h: 0, s: 0, l: 0 };
            baseColor.getHSL(hsl);

            const hueJitter = (Math.random() - 0.5) * 0.08;   // ±4% di tonalità
            const satJitter = (Math.random() - 0.5) * 0.5;    // ±25% di saturazione
            const lightJitter = (Math.random() - 0.5) * 0.36; // ±18% di luminosità

            const color = new THREE.Color();
            color.setHSL(
                THREE.MathUtils.euclideanModulo(hsl.h + hueJitter, 1),
                THREE.MathUtils.clamp(hsl.s + satJitter, 0.0, 1.0),
                THREE.MathUtils.clamp(hsl.l + lightJitter, 0.15, 0.85)
            );

            boidColors[i] = color;
        }

        for (let i = 0; i < boidCount; i++) {
            // Ala superiore sinistra (forewing): cardine, angolo, punta in avanti
            vertsPush(
                0, 0, 0,
                -foreSpanX, 0, 0,
                -foreSpanX, 0, foreForwardZ
            );

            // Ala inferiore sinistra (hindwing): cardine, angolo, punta all'indietro
            vertsPush(
                0, 0, 0,
                -hindSpanX, 0, 0,
                -hindSpanX, 0, -hindBackZ
            );

            // Ala superiore destra (forewing)
            vertsPush(
                0, 0, 0,
                foreSpanX, 0, 0,
                foreSpanX, 0, foreForwardZ
            );

            // Ala inferiore destra (hindwing)
            vertsPush(
                0, 0, 0,
                hindSpanX, 0, 0,
                hindSpanX, 0, -hindBackZ
            );
        }

        for (let v = 0; v < triangles * 3; v++) {
            const triangleIndex = Math.floor(v / 3);
            const birdIndex = Math.floor(triangleIndex / trianglesPerBird);

            /*
             * Coordinate UV nella texture GPGPU.
             * Ogni boid corrisponde a un pixel della texture.
             * Usiamo + 0.5 per puntare al centro del pixel.
             */
            const x = ((birdIndex % textureWidth) + 0.5) / textureWidth;
            const y = (Math.floor(birdIndex / textureWidth) + 0.5) / textureWidth;

            const color = boidColors[birdIndex];

            birdColors.array[v * 3 + 0] = color.r;
            birdColors.array[v * 3 + 1] = color.g;
            birdColors.array[v * 3 + 2] = color.b;

            references.array[v * 2 + 0] = x;
            references.array[v * 2 + 1] = y;
        }

        this.scale(0.2, 0.2, 0.2);
    }
}