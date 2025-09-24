import SwaggerAutoGen from "swagger-autogen";
const swaggerAutogen = SwaggerAutoGen();

const doc = {
  info: {
    title: "KAI",
    description: "backend bank application",
  },
  host: "localhost:5000",
  schemes: ["http"],
};

const outputFile = "./swagger-output.json";
const endpointsFiles = ["../app"]; // Point to your main route files or an entry point like `app.js`

swaggerAutogen(outputFile, endpointsFiles, doc);
