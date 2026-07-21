/*
 * birdVertex.glsl
 *
 * Vertex shader per renderizzare graficamente i boids.
 *
 * La simulazione fisica non avviene qui, ma negli shader GPGPU
 * fragmentShaderPosition.glsl e fragmentShaderVelocity.glsl.
 *
 * Questo shader:
 * - legge la posizione del boid da texturePosition;
 * - legge la velocità del boid da textureVelocity;
 * - orienta la geometria del boid nella direzione della velocità;
 * - anima il movimento delle ali usando la fase salvata in texturePosition.w;
 * - passa il colore e la profondità al fragment shader.
 */

attribute vec2 reference;
attribute vec3 birdColor;
attribute float birdScale;

uniform sampler2D texturePosition;
uniform sampler2D textureVelocity;

uniform float time;

varying vec4 vColor;
varying float z;

void main() {

    vec4 tmpPos = texture2D(texturePosition, reference);
    vec3 pos = tmpPos.xyz;

    vec3 velocity = normalize(texture2D(textureVelocity, reference).xyz);

    /*
     * Scala individuale del boid (dimensione farfalla), applicata subito
     * sulla geometria locale prima di piegatura e rotazione: il cardine
     * resta a (0,0,z) per costruzione, quindi scalare non lo sposta,
     * cambia solo l'apertura alare.
     */
    vec3 scaledPosition = position * birdScale;
    vec3 newPosition = scaledPosition;

    /*
     * Animazione delle ali: piegatura rigida lungo l'asse del corpo (x=0),
     * come chiudere/aprire un libro lungo la costola.
     *
     * Ogni vertice delle ali ruota attorno all'asse z (l'asse del corpo)
     * in base alla propria distanza dal cardine (scaledPosition.x). I
     * vertici sul cardine hanno x=0 e quindi restano fermi per
     * costruzione: non c'è nessuno spostamento "a mano" di vertici
     * specifici.
     *
     * foldAngle oscilla tra 0 (ali completamente aperte, piatte) e
     * maxFoldAngle (ali quasi chiuse verso l'alto): usiamo
     * 0.5 + 0.5*sin(...) invece di sin(...) puro perché le ali di una
     * farfalla si piegano sempre nella stessa direzione (verso l'alto),
     * non specularmente sopra e sotto il corpo.
     *
     * Usiamo abs(scaledPosition.x) per l'altezza (newPosition.y) così le
     * ali sinistra e destra si piegano nella STESSA direzione (verso
     * l'alto), come un libro che si chiude, invece di ruotare una in
     * avanti e l'altra all'indietro. La coordinata z non viene mai
     * toccata: ogni punto resta esattamente alla sua profondità lungo il
     * corpo, cioè "in posizione" lungo la linea di piega.
     */
    float maxFoldAngle = radians(75.0);
    float foldAngle = maxFoldAngle * (0.5 + 0.5 * sin(tmpPos.w));

    float foldSin = sin(foldAngle);
    float foldCos = cos(foldAngle);

    newPosition.y = abs(scaledPosition.x) * foldSin;
    newPosition.x = scaledPosition.x * foldCos;

    newPosition = mat3(modelMatrix) * newPosition;

    /*
     * Calcolo della rotazione in base alla direzione di volo.
     */
    velocity.z *= -1.0;

    float xz = length(velocity.xz);
    float xyz = 1.0;
    float x = sqrt(1.0 - velocity.y * velocity.y);

    float cosry = velocity.x / xz;
    float sinry = velocity.z / xz;

    float cosrz = x / xyz;
    float sinrz = velocity.y / xyz;

    mat3 maty = mat3(
        cosry, 0.0, -sinry,
        0.0,   1.0,  0.0,
        sinry, 0.0,  cosry
    );

    mat3 matz = mat3(
        cosrz,  sinrz, 0.0,
        -sinrz, cosrz, 0.0,
        0.0,    0.0,   1.0
    );

    newPosition = maty * matz * newPosition;
    newPosition += pos;

    z = newPosition.z;

    vColor = vec4(birdColor, 1.0);

    gl_Position = projectionMatrix * viewMatrix * vec4(newPosition, 1.0);
}