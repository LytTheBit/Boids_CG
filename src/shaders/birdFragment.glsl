/*
 * birdFragment.glsl
 *
 * Fragment shader per il colore finale dei boids.
 *
 * Riceve dal vertex shader:
 * - vColor: colore associato ai vertici del boid;
 * - z: profondità del vertice nello spazio 3D.
 *
 * In questa versione il colore è volutamente semplice:
 * viene calcolata una tonalità di grigio in base alla profondità.
 *
 * Questo è uno dei punti più facili da modificare se vuoi migliorare
 * l'aspetto visivo dei boids, ad esempio introducendo colori diversi,
 * shading più realistico o variazioni per gruppi di boids.
 */

varying vec4 vColor;
varying float z;

uniform vec3 color;

void main() {

    float z2 = 0.2 + (1000.0 - z) / 1000.0 * vColor.x;

    gl_FragColor = vec4(z2, z2, z2, 1.0);
}