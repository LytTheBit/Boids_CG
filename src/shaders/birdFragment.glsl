/*
 * birdFragment.glsl
 *
 * Fragment shader per il colore finale dei boids.
 *
 * Il colore arriva da BirdGeometry.js tramite l'attributo birdColor.
 * Ogni specie riceve un colore diverso:
 * - grigio scuro;
 * - blu;
 * - azzurro;
 * - verde;
 * - verdeacqua;
 * - ecc.
 *
 * Viene applicato anche un semplice fattore di profondità,
 * così i boids più lontani risultano leggermente meno luminosi.
 */

varying vec4 vColor;
varying float z;

uniform vec3 color;

void main() {
    float depthFactor = 0.4 + (1000.0 - z) / 1000.0 * 0.6;
    depthFactor = clamp(depthFactor, 0.25, 1.0);

    vec3 finalColor = vColor.rgb * depthFactor;

    gl_FragColor = vec4(finalColor, 1.0);
}