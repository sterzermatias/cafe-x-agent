// Punto de entrada de la app — equivalente al "main()" de cualquier lenguaje
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  // NestFactory crea la instancia de la app a partir del módulo raíz
  const app = await NestFactory.create(AppModule);
  // Levanta el servidor HTTP en el puerto indicado (env o 3000 por defecto)
  await app.listen(process.env.PORT ?? 3000);
}
// "void" descarta la Promise — indica que no nos interesa el resultado del async
void bootstrap();
