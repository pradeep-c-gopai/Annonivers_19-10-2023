// Copyright Epic Games, Inc. All Rights Reserved.
// This is tesing server
//-- Server side logic. Serves pixel streaming WebRTC-based page, proxies data back to Streamer --//
//Testing gitlab pipelines


var express = require("express");
var app = express();
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const querystring = require("querystring");
const bodyParser = require("body-parser");
const mysql = require('mysql');
const util = require('util');
const { validateToken } = require('./validateToken/hasAccess');
app.use(bodyParser.json());
const logging = require("./modules/logging.js");
require("@shopify/shopify-api/adapters/node");
const {
  shopifyApi,
  LATEST_API_VERSION,
  Session,
} = require("@shopify/shopify-api");
const { restResources } = require("@shopify/shopify-api/rest/admin/2023-01");
const LocalStorage = require("node-localstorage").LocalStorage;
var localStorage = new LocalStorage("./scratch");
const { exec, spawn } = require("child_process");
const treeKill = require("tree-kill");
const { v4: uuidv4 } = require('uuid');
logging.RegisterConsoleLogger();
const Shopify = require("shopify-api-node");
// const fetch = require("node-fetch");
var cors = require("cors");
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

var app = express();
app.use(cors());

const verifyToken = require('./middleware/middleWare');

// Command line argument --configFile needs to be checked before loading the config, all other command line arguments are dealt with through the config object

const defaultConfig = {
  UseFrontend: false,
  UseMatchmaker: false,
  UseHTTPS: false,
  UseAuthentication: false,
  LogToFile: true,
  LogVerbose: true,
  HomepageFile: "player.html",
  AdditionalRoutes: new Map(),
  EnableWebserver: true,
  MatchmakerAddress: "",
  MatchmakerPort: "9999",
  PublicIp: "localhost",
  HttpPort: 80,
  HttpsPort: 443,
  StreamerPort: 8888,
  SFUPort: 8889,
  MaxPlayerCount: -1,
};

const argv = require("yargs").argv;
var configFile =
  typeof argv.configFile != "undefined"
    ? argv.configFile.toString()
    : path.join(__dirname, "config.json");
// console.log(`configFile ${configFile}`);
const config = require("./modules/config.js").init(configFile, defaultConfig);

if (config.LogToFile) {
  logging.RegisterFileLogger("./logs");
}

var http = require("http").Server(app);

if (config.UseHTTPS) {
  //HTTPS certificate details
  const options = {
    key: fs.readFileSync(path.join(__dirname, "./certificates/privkey.pem")),
    cert: fs.readFileSync(
      path.join(__dirname, "./certificates/cert.pem")
    ),
  };

  var https = require("https").Server(options, app);
}

//If not using authetication then just move on to the next function/middleware
var isAuthenticated = (redirectUrl) =>
  function (req, res, next) {
    return next();
  };

if (config.UseAuthentication && config.UseHTTPS) {
  var passport = require("passport");
  require("./modules/authentication/index.js").init(app);
  // Replace the isAuthenticated with the one setup on passport module
  isAuthenticated = passport.authenticationMiddleware
    ? passport.authenticationMiddleware
    : isAuthenticated;
} else if (config.UseAuthentication && !config.UseHTTPS) {
  console.error(
    "Trying to use authentication without using HTTPS, this is not allowed and so authentication will NOT be turned on, please turn on HTTPS to turn on authentication"
  );
}

const helmet = require("helmet");
var hsts = require("hsts");
var net = require("net");

var FRONTEND_WEBSERVER = "https://localhost";
if (config.UseFrontend) {
  var httpPort = 3000;
  var httpsPort = 8000;

  //Required for self signed certs otherwise just get an error back when sending request to frontend see https://stackoverflow.com/a/35633993
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

  const httpsClient = require("./modules/httpsClient.js");
  var webRequest = new httpsClient();
} else {
  var httpPort = config.HttpPort;
  var httpsPort = config.HttpsPort;
}

var streamerPort = config.StreamerPort; // port to listen to Streamer connections
var sfuPort = config.SFUPort;

var matchmakerAddress = "127.0.0.1";
var matchmakerPort = 9999;
var matchmakerRetryInterval = 5;
var matchmakerKeepAliveInterval = 30;
var maxPlayerCount = -1;

var gameSessionId;
var userSessionId;
var serverPublicIp;

// `clientConfig` is send to Streamer and Players
// Example of STUN server setting
// let clientConfig = {peerConnectionOptions: { 'iceServers': [{'urls': ['stun:34.250.222.95:19302']}] }};
var clientConfig = { type: "config", peerConnectionOptions: {} };
var db = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "Metaverse@2023",
  database: 'anonyverse'
});
db.connect(err => {
  if (err) throw err
  console.log('MySQL database connected successfully!')
});

// Parse public server address from command line
// --publicIp <public address>
try {
  if (typeof config.PublicIp != "undefined") {
    serverPublicIp = config.PublicIp.toString();
  }

  if (typeof config.HttpPort != "undefined") {
    httpPort = config.HttpPort;
  }

  if (typeof config.HttpsPort != "undefined") {
    httpsPort = config.HttpsPort;
  }

  if (typeof config.StreamerPort != "undefined") {
    streamerPort = config.StreamerPort;
  }

  if (typeof config.SFUPort != "undefined") {
    sfuPort = config.SFUPort;
  }

  if (typeof config.FrontendUrl != "undefined") {
    FRONTEND_WEBSERVER = config.FrontendUrl;
  }

  if (typeof config.peerConnectionOptions != "undefined") {
    clientConfig.peerConnectionOptions = JSON.parse(
      config.peerConnectionOptions
    );
    console.log(
      `peerConnectionOptions = ${JSON.stringify(
        clientConfig.peerConnectionOptions
      )}`
    );
  } else {
    console.log("No peerConnectionConfig");
  }

  if (typeof config.MatchmakerAddress != "undefined") {
    matchmakerAddress = config.MatchmakerAddress;
  }

  if (typeof config.MatchmakerPort != "undefined") {
    matchmakerPort = config.MatchmakerPort;
  }

  if (typeof config.MatchmakerRetryInterval != "undefined") {
    matchmakerRetryInterval = config.MatchmakerRetryInterval;
  }

  if (typeof config.MaxPlayerCount != "undefined") {
    maxPlayerCount = config.MaxPlayerCount;
  }
} catch (e) {
  console.error(e);
  process.exit(2);
}

if (config.UseHTTPS) {
  app.use(helmet());

  app.use(
    hsts({
      maxAge: 15552000, // 180 days in seconds
    })
  );

  //Setup http -> https redirect
  console.log("Redirecting http->https");
  app.use(function (req, res, next) {
    if (!req.secure) {
      if (req.get("Host")) {
        var hostAddressParts = req.get("Host").split(":");
        var hostAddress = hostAddressParts[0];
        if (httpsPort != 443) {
          hostAddress = `${hostAddress}:${httpsPort}`;
        }
        return res.redirect(
          ["https://", hostAddress, req.originalUrl].join("")
        );
      } else {
        console.error(
          `unable to get host name from header. Requestor ${req.ip
          }, url path: '${req.originalUrl}', available headers ${JSON.stringify(
            req.headers
          )}`
        );
        return res.status(400).send("Bad Request");
      }
    }
    next();
  });
}

sendGameSessionData();

//Setup the login page if we are using authentication
if (config.UseAuthentication) {
  if (config.EnableWebserver) {
    app.get("/login", function (req, res) {
      res.sendFile(__dirname + "/login.htm");
    });
  }

  // create application/x-www-form-urlencoded parser
  var urlencodedParser = bodyParser.urlencoded({ extended: false });

  //login page form data is posted here
  app.post(
    "/login",
    urlencodedParser,
    passport.authenticate("local", { failureRedirect: "/login" }),
    function (req, res) {
      //On success try to redirect to the page that they originally tired to get to, default to '/' if no redirect was found
      var redirectTo = req.session.redirectTo ? req.session.redirectTo : "/";
      delete req.session.redirectTo;
      console.log(`Redirecting to: '${redirectTo}'`);
      res.redirect(redirectTo);
    }
  );
}

if (config.EnableWebserver) {
  //Setup folders
  app.use(express.static(path.join(__dirname, "/Public")));
  app.use("/images", express.static(path.join(__dirname, "./images")));
  app.use("/scripts", [
    isAuthenticated("/login"),
    express.static(path.join(__dirname, "/scripts")),
  ]);
  app.use("/", [
    isAuthenticated("/login"),
    express.static(path.join(__dirname, "/custom_html")),
  ]);
}

try {
  for (var property in config.AdditionalRoutes) {
    if (config.AdditionalRoutes.hasOwnProperty(property)) {
      console.log(
        `Adding additional routes "${property}" -> "${config.AdditionalRoutes[property]}"`
      );
      app.use(property, [
        isAuthenticated("/login"),
        express.static(path.join(__dirname, config.AdditionalRoutes[property])),
      ]);
    }
  }
} catch (err) {
  console.error(`reading config.AdditionalRoutes: ${err}`);
}
const shopify = shopifyApi({
  apiKey: "893e616e50ff70fa50ae43f28ca9f4bb",
  apiSecretKey: "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", // Note: this is the Admin API access token, NOT the API Secret Key
  apiVersion: LATEST_API_VERSION,
  isCustomStoreApp: true, // this MUST be set to true (default is false)
  //scopes: [read_customers, write_customers, read_analytics, write_assigned_fulfillment_orders, read_assigned_fulfillment_orders, write_custom_pixels, read_custom_pixels, read_customer_events, read_discounts, write_discounts, read_discovery, write_discovery, write_draft_orders, read_draft_orders, write_files, read_files, read_fulfillments, write_fulfillments, read_gdpr_data_request, read_gift_cards, write_gift_cards, read_inventory, write_inventory, write_legal_policies, read_legal_policies, write_locations, read_locations, write_marketing_events, read_marketing_events, write_merchant_managed_fulfillment_orders, read_merchant_managed_fulfillment_orders, write_metaobject_definitions, read_metaobject_definitions, write_metaobjects, read_metaobjects, read_online_store_navigation, write_online_store_pages, read_online_store_pages, read_order_edits, write_order_edits, write_orders, read_orders, write_packing_slip_templates, read_packing_slip_templates, write_payment_customizations, read_payment_customizations, write_payment_terms, read_payment_terms, write_pixels, read_pixels, write_product_feeds, read_product_feeds, write_price_rules, read_price_rules, write_product_listings, read_product_listings, write_products, read_products, write_publications, read_publications, write_purchase_options, read_purchase_options, write_reports, read_reports, write_resource_feedbacks, read_resource_feedbacks, write_returns, read_returns, write_channels, read_channels, write_script_tags, read_script_tags, write_shipping, read_shipping, write_locales, read_locales, write_shopify_credit, read_shopify_credit, write_markets, read_markets, read_shopify_payments_accounts, read_shopify_payments_bank_accounts, read_shopify_payments_disputes, read_shopify_payments_payouts, write_themes, read_themes, read_content, write_third_party_fulfillment_orders, read_third_party_fulfillment_orders, write_translations, read_translations, write_custom_fulfillment_services, read_custom_fulfillment_services, write_customer_merge, read_customer_merge, write_delivery_customizations, read_delivery_customizations, write_gates, read_gates],
  isEmbeddedApp: false,
  hostName: "metshopy.myshopify.com",
  // Mount REST resources.
  restResources,
});

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

async function create_customer(username, email, phone, password, con_password) {
  const session = shopify.session.customAppSession("metshopy.myshopify.com");
  const customer = new shopify.rest.Customer({ session: session });
  customer.first_name = username;
  customer.email = email;
  customer.phone = phone;
  customer.password = password;
  customer.password_confirmation = con_password;
  customer.verified_email = true;
  let abb = await customer.save({ update: true });
  localStorage.setItem("customer", customer.id);
  // console.logColor(
  //   logging.White,
  //   "Customer is Created with username " + customer && customer.first_name
  // );
  return customer;
}

if (config.EnableWebserver) {
  app.get("/", (req, res) => {
    res.redirect("register.html");
    // res.redirect("player.html?hoveringMouse=true");
  });
}
// app.post('/register', async (req, res) => {
// console.log("Starting register.html 22");
// const username = req.body.username;
// const email = req.body.email;
// const phone = req.body.phone;

// try {
// const session = shopify.session.customAppSession("metshopy.myshopify.com");
// const customer = new shopify.rest.Customer({ session: session });
// customer.first_name = username;
// customer.email = email;
// customer.phone = phone;
// customer.verified_email = true;
// await customer.save({ update: true });
// console.logColor(logging.White, "Customer is Created with username " + customer.first_name);
// res.redirect("/player");
// } catch (error) {
// res.status(500).send(`
// <html>
// <head>
// <title>Error creating customer</title>
// </head>
// <body>
// <h1>Error creating customer</h1>
// <p>${error.message}</p>
// </body>
// </html>
// `);
// }
// });

// /api/post/reviews/:productId/:payload
app.post("/register", async (req, res) => {
  const { username, email, phone, password, con_password } = req.body;
  try {
    const data = await create_customer(
      username,
      email,
      phone,
      password,
      con_password
    );
    console.log("Register 11", data);
    res.status(200).send({
      data: data,
      message: "SUCCESS",
    });
  } catch (error) {
    console.log("Register 22", error && error.message);
    return res.status(500).send({
      message: "FAILED",
    });
  }
});

app.post("/product_details", (req, res) => {
  if (req.body.id == null) {
    console.logColor("Viral321");
  } else {
    let pro_detail;
    let vdict = [];
    const id = req.body.id;
    const session = shopify.session.customAppSession(
      "metshopy.myshopify.com"
    );
    async function product_detail() {
      const queryString = `{
product(id:"gid://shopify/Product/${id}") {
title
description
variants(first: 10) {
edges {
node {
id
price
title
image {
id
originalSrc
}
metafields(first:10){
  edges{
  node{
  namespace
  key
  value
  }
  }
  }
}
}
}
media(first:5) {
edges {
node {
... fieldsForMediaTypes
}
}
}
}
}
 
fragment fieldsForMediaTypes on Media {
alt
mediaContentType
preview {
image {
id
altText
url
}
}
status
... on Video {
id
sources {
format
height
mimeType
url
width
}
originalSource {
format
height
mimeType
url
width
}
}
... on ExternalVideo {
id
host
embeddedUrl
}
... on Model3d {
sources {
format
mimeType
url
}
originalSource {
format
mimeType
url
}
}
... on MediaImage {
id
image {
altText
url
}
}
}`;
      const client = new shopify.clients.Graphql({ session });
      const products = await client.query({
        data: queryString,
      });
      const modelImage =
        products.body.data.product &&
        products.body.data.product.media &&
        products.body.data.product.media.edges[0] &&
        products.body.data.product.media.edges[0].node &&
        products.body.data.product.media.edges[0].node.originalSource &&
        products.body.data.product.media.edges[0].node.originalSource.url;
      console.log("products.body.data", JSON.stringify(products));
      const title = products.body.data.product.title;
      const desc = products.body.data.product.description;
      for (i = 0; i < products.body.data.product.variants.edges.length; i++) {
        const vid =
          products.body.data.product.variants.edges[i].node.id.split("/")[4];
        const vtitle =
          products.body.data.product.variants.edges[i].node.title;
        const vprice =
          products.body.data.product.variants.edges[i].node.price;
        const vimage =
          products.body.data.product.variants.edges[i] &&
          products.body.data.product.variants.edges[i].node &&
          products.body.data.product.variants.edges[i].node.image &&
          products.body.data.product.variants.edges[i].node.image.originalSrc;

        const rgbMetafield =
          products.body.data.product.variants.edges[i] &&
          products.body.data.product.variants.edges[i].node &&
          products.body.data.product.variants.edges[i].node.metafields &&
          products.body.data.product.variants.edges[i].node.metafields.edges[0] &&
          products.body.data.product.variants.edges[i].node.metafields.edges[0].node &&
          products.body.data.product.variants.edges[i].node.metafields.edges[0].node.value;

        const outerSoleMetafield =
          products.body.data.product.variants.edges[i] &&
          products.body.data.product.variants.edges[i].node &&
          products.body.data.product.variants.edges[i].node.metafields &&
          products.body.data.product.variants.edges[i].node.metafields.edges[0] &&
          products.body.data.product.variants.edges[i].node.metafields.edges[0].node &&
          products.body.data.product.variants.edges[i].node.metafields.edges[1].node.value;

        const innerSoleMetafield =
          products.body.data.product.variants.edges[i] &&
          products.body.data.product.variants.edges[i].node &&
          products.body.data.product.variants.edges[i].node.metafields &&
          products.body.data.product.variants.edges[i].node.metafields.edges[0] &&
          products.body.data.product.variants.edges[i].node.metafields.edges[0].node &&
          products.body.data.product.variants.edges[i].node.metafields.edges[2].node.value;

        const innerMetafield =
          products.body.data.product.variants.edges[i] &&
          products.body.data.product.variants.edges[i].node &&
          products.body.data.product.variants.edges[i].node.metafields &&
          products.body.data.product.variants.edges[i].node.metafields.edges[0] &&
          products.body.data.product.variants.edges[i].node.metafields.edges[0].node &&
          products.body.data.product.variants.edges[i].node.metafields.edges[3].node.value;

        const shirtColorMetafield =
          products.body.data.product.variants.edges[i] &&
          products.body.data.product.variants.edges[i].node &&
          products.body.data.product.variants.edges[i].node.title &&
          products.body.data.product.variants.edges[i].node.title.split("/")[2];

        if (
          products.body.data.product.variants.edges[i].node.title.split(" / ")
            .length == 3 || products.body.data.product.variants.edges[i].node.title.split(" / ")
              .length == 2
        ) {
          const vskey =
            products.body.data.product.variants.edges[i].node.title.split(
              " / "
            )[0];
          const vckey =
            products.body.data.product.variants.edges[i].node.title.split(
              " / "
            )[1];

          vdict.push({
            id: vid,
            title: vtitle,
            price: vprice,
            image: vimage,
            size: vskey,
            color: vckey,
            rgbCode: rgbMetafield,
            innerColor: innerMetafield,
            outerSoleColor: outerSoleMetafield,
            innerSoleColor: innerSoleMetafield,
            shirtColor: shirtColorMetafield
          });
        } else {
          const vkey =
            products.body.data.product.variants.edges[i].node.title;
          vdict.push({
            id: vid,
            title: vtitle,
            price: vprice,
            image: vimage,
            size: vkey,
          });
        }
      }
      pro_detail = {
        id: id,
        title: title,
        description: desc,
        image: modelImage,
        variants: vdict,
      };
      res.send(JSON.stringify(pro_detail));
    }
    product_detail();
  }
});

app.post("/shipping_add", (req, res) => {
  const cust_id = localStorage.getItem("customer");
  //const cust_id = 7109252251945;
  console.log("customer id 22", cust_id);
  async function get_add() {
    let add = [];
    const session = shopify.session.customAppSession(
      "metshopy.myshopify.com"
    );

    const exist_add = await shopify.rest.Customer.find({
      session: session,
      id: cust_id,
    });
    if (exist_add.addresses.length == 0) {
      res.send(JSON.stringify(null));
    } else {
      for (let i = 0; i < exist_add.addresses.length; i++) {
        const firstname = exist_add.addresses[i].first_name;
        const lastname = exist_add.addresses[i].last_name;
        const address1 = exist_add.addresses[i].address1;
        const address2 = exist_add.addresses[i].address2;
        const city = exist_add.addresses[i].city;
        const country = exist_add.addresses[i].country;
        const phone = exist_add.addresses[i].phone;
        const postalcode = exist_add.addresses[i].zip;
        const dfault = exist_add.addresses[i].default;
        add.push({
          firstname: firstname,
          lastname: lastname,
          address1: address1,
          address2: address2,
          city: city,
          country: country,
          postalcode: postalcode,
          phone: phone,
          default: dfault,
        });
      }
      res.send(JSON.stringify(add));
    }
  }
  get_add();
});

app.post("/new_add", (req, res) => {
  try {
    const now = new Date();
    const dateTimeString = now.toLocaleString();
    const cust_id = localStorage.getItem("customer");
    //const cust_id = 7109252251945;
    const address1 = req.body.address;
    const address2 = req.body.apartment;
    const city = req.body.city;
    const first_name = req.body.firstName;
    const last_name = req.body.lastName;
    const phone = req.body.phone;
    const country = req.body.country;
    const zip = req.body.postalCode;

    const session = shopify.session.customAppSession("metshopy.myshopify.com");
    const customer_address = new shopify.rest.CustomerAddress({
      session: session,
    });
    customer_address.customer_id = cust_id;
    customer_address.address1 = address1;
    customer_address.address2 = address2;
    customer_address.city = city;
    customer_address.first_name = first_name;
    customer_address.last_name = last_name;
    customer_address.phone = phone;
    customer_address.country = country;
    customer_address.zip = zip;
    customer_address.signature = dateTimeString;
    customer_address.default = true;

    customer_address.save({
      update: true,
    })
      .then((response) => {
        // Address successfully saved
        console.logColor(JSON.stringify(customer_address));
        console.logColor(logging.White, "Address is stored successfully...");
        res.status(200).send(customer_address);
      })
      .catch((error) => {
        // Handle errors here
        console.error("Error saving customer address:", error);
        // You can check the error object for more information about the error
        if (error.response) {
          // The response contains details about the error
          //console.error("Shopify API response:", error.response);
          res.status(500).json(error.response.body.errors);
        }
      });
  }
  catch (error) {
    console.error("An error occurred:", error);
  }
});

app.post("/draft_order", (req, res) => {
  const cust_id = localStorage.getItem("customer")
  //const cust_id = 7109252251945;
  const cart = req.body.cart;
  const add = req.body.add;

  console.logColor(cart);
  async function draft() {
    const session = shopify.session.customAppSession(
      "metshopy.myshopify.com"
    );
    const draft_order = new shopify.rest.DraftOrder({ session: session });
    draft_order.line_items = cart;
    draft_order.shipping_address = add;
    draft_order.customer = { id: cust_id };
    await draft_order.save({
      update: true,
    });
    console.logColor(
      logging.White,
      "Draft order is generated successfully..."
    );
    localStorage.setItem("draft", draft_order.id);
    const responseObj = {
      status: "Success",
      id: draft_order.id
    };

    res.json(responseObj);
    // res.send("Success...");
  }
  draft();
});

class CreateInvoiceRequest {
  constructor(orderId, price, email) {
    this.orderId = orderId;
    this.price = price;
    this.email = email;
  }
}

class CreateInvoiceResponse {
  constructor(url, status, price, currency, orderId, id) {
    this.url = url;
    this.status = status;
    this.price = price;
    this.currency = currency;
    this.orderId = orderId;
    this.id = id;
  }
}



async function createInvoice(orderId, price, email) {
  const url = 'https://test.bitpay.com/invoices';

  const headers = {
    'X-Accept-Version': '2.0.0',
    'Content-Type': 'application/json',
    'X-Identity': '02811dcd84bb5f436269ed070c27858f872196c90ce77cf869cf3516c82477d22e',
  };

  const requestBody = {
    currency: 'USD',
    price: price,
    orderId: orderId,
    buyer: {
      email: email,
    },
    token: '7fCwqRfQ7a1j6d3UinZRa9nL5MA6EKsqzURSXiQ6CiNc',
  };

  try {
    const response = await axios.post(url, requestBody, { headers });
    const responseData = response.data.data; // Store response data in a separate variable
    const { url: responseUrl, status, price, currency, orderId, id } = responseData; // Rename `url` to `responseUrl`
    return new CreateInvoiceResponse(responseUrl, status, price, currency, orderId, id);
  } catch (error) {
    console.error('Error:', error.message);
    throw new Error('An error occurred');
  }
}

app.post('/create-invoice', async (req, res) => {
  console.logColor(JSON.stringify(req.body), "inside")
  const { orderId, price, email } = req.body;
  const requestDTO = new CreateInvoiceRequest(orderId, price, email);

  try {
    const responseData = await createInvoice(requestDTO.orderId, requestDTO.price, requestDTO.email);
    return res.json({ data: responseData });
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ error: 'An error occurred' });
  }
});

// Define the DTO for invoice status response
class InvoiceStatusDTO {
  constructor(status, txhash) {
    this.status = status;
    this.txhash = txhash;
  }
}

function getInvoiceStatus(invoiceId) {
  const url = `https://test.bitpay.com/invoices/${invoiceId}?token=7fCwqRfQ7a1j6d3UinZRa9nL5MA6EKsqzURSXiQ6CiNc`;
  const headers = {
    'X-Accept-Version': '2.0.0',
    'Content-Type': 'application/json',
    'X-Identity': '02811dcd84bb5f436269ed070c27858f872196c90ce77cf869cf3516c82477d22e'
  };

  return axios
    .get(url, { headers })
    .then(response => {
      const { status, txhash } = response.data.data;
      const txhashValue = txhash ? txhash : null;
      return new InvoiceStatusDTO(status, txhashValue);
    })
    .catch(error => {
      console.error('Error:', error.message);
      throw new Error('An error occurred');
    });
}

app.get('/invoice-status', async (req, res) => {
  const invoiceId = req.query.invoiceId;

  try {
    const invoiceStatus = await getInvoiceStatus(invoiceId);
    res.json({ data: invoiceStatus });
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ error: 'An error occurred' });
  }
});

app.post("/complete_order", (req, res) => {
  const draft_id = localStorage.getItem("draft");
  async function complete_draft() {
    const session = shopify.session.customAppSession(
      "metshopy.myshopify.com"
    );
    const draft_order = new shopify.rest.DraftOrder({ session: session });
    draft_order.id = draft_id;
    await draft_order.complete({});
    res.send({
      message: "Order generated successfully....",
    });
  }
  complete_draft();
});
let batchPID = [];
let batchMap = new Map();
app.get('/start_exe', (req, res) => {
  const uuid = uuidv4();
  console.log(uuid, 'uuid');
  StartExeProcess();
  return res.status(200).send(JSON.stringify({ uuid: uuid }));
});

const shopifyGraphQLUrl = 'https://metshopy.myshopify.com/api/2023-01/graphql.json';
const accessToken = 'a8e1b986e492b696cc3dfa25cbf6e26d'; // Replace with your access token


async function recoverCustomerByEmail(email) {
  try {
    const response = await axios.post(
      shopifyGraphQLUrl,
      {
        query: `
            mutation customerRecover($email: String!) {
              customerRecover(email: $email) {
                customerUserErrors {
                  message
                }
              }
            }
          `,
        variables: {
          email: email,
        },
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Storefront-Access-Token': accessToken,
        },
      }
    );

    return response.data.data.customerRecover;
  } catch (error) {
    console.error('Error recovering customer:', error);
    throw error;
  }
}


app.post('/recover-customer', async (req, res) => {
  const email = req.body.email;

  try {
    const customerRecover = await recoverCustomerByEmail(email);

    res.json({ customerRecover });
  } catch (error) {
    res.status(500).json({ error: 'An error occurred while recovering the customer.' });
  }
});

async function customerResetByUrl(password, resetUrl) {
  const shopifyApiUrl = 'https://metshopy.myshopify.com/api/2023-01/graphql.json'; //Changed the URL


  const query = `
      mutation customerResetByUrl($password: String!, $resetUrl: URL!) {
        customerResetByUrl(password: $password, resetUrl: $resetUrl) {
          customer {
            firstName
          }
          customerAccessToken {
            accessToken
          }
          customerUserErrors {
            message
          }
        }
      }
    `;

  const variables = {
    password: password,
    resetUrl: resetUrl
  };

  try {
    const response = await axios.post(
      shopifyApiUrl,
      {
        query: query,
        variables: variables
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-Shopify-Storefront-Access-Token': accessToken
        }
      }
    );

    const responseData = response.data;
    const customerUserErrors = responseData.data.customerResetByUrl.customerUserErrors;

    if (customerUserErrors.length > 0) {
      // There are errors, return only the customerUserErrors
      return { customerUserErrors };
    }

    // No errors, return the complete response
    return responseData;
  } catch (error) {
    console.error('Error executing GraphQL mutation:', error.response.data);
    throw error;
  }
}

// Parse incoming request bodies
app.use(bodyParser.json());

// Create a route to handle the customer reset request
app.post('/customer/reset', async (req, res) => {
  const password = req.body.password;
  const resetUrl = req.body.resetUrl;

  try {
    const response = await customerResetByUrl(password, resetUrl);
    res.json(response);
  } catch (error) {
    console.log(error, "error");
    res.status(500).json({ error: error.message });
  }
});

app.post('/active_user', (req, res) => {
  const { SessionId, customer_id, customer_uuid, avtar_name, avtar_url } = req.body;
  console.log(JSON.stringify(req.body), 'body');
  db.query(`SELECT id from sessions WHERE session_uuid = '${SessionId}'`, (error, results) => {
    if (error) {
      console.error('Error querying the database:', error);
      return res.status(500);
    }
    db.query(`INSERT INTO active_users (customer_id, customer_uuid, avatar_name, avatar_url, session_id) VALUES (${customer_id}, '${customer_uuid}', '${avtar_name}', '${avtar_url}', ${results[0].id})`, (error, results) => {
      if (error) {
        console.error('Error querying the database:', error);
        return res.status(500);
      }
      // console.log(JSON.stringify(results),'results');
    });
    res.status(200);
  });
});

function StartExeProcess() {
  db.query('SELECT * FROM ports where is_used =0', (error, results) => {
    if (error) {
      console.error('Error querying the database:', error);
      return;
    }
    results.forEach((item) => {
      if (item.signalling_server_port == httpPort) {
        db.query(`UPDATE ports SET is_used = 1 WHERE signalling_server_port=${httpPort}`, (error) => {
          if (error) {
            console.error('Error querying the database:', error);
            return;
          }
          console.log("Updated...")
        });
      }
    });
    //.log(httpPort, 'http');
    db.query(`SELECT * FROM ports where signalling_server_port=${httpPort}`, (error, results) => {
      if (error) {
        console.error('Error querying the database:', error);
        return;
      }
      //console.log(JSON.stringify(results),'r');
      // const exePath = "D:/Others/Rohit/Demo1/Demo/package/OctoberPackage/New4/Windows/Demo.exe";
      //const exePath = "D:/Prod/Avatar/Windows/UnrealExamples.exe";
      // const exePath = "D:/Others/Rohit/Demo1/Demo/package/OctoberPackage/Latest/Windows/Demo.exe";
      const exePath = "D:/Others/Rohit/Demo1/Demo/package/OctoberPackage/Dev_exe/Windows/Demo.exe"; //Latest packed exe done on 18-10-2023
      const args = [`127.0.0.1:7777}`, '-game', '-nosteam', '-PixelStreamingIP=metaverse.sakhaglobal.com', `-PixelStreamingPort=${results[0].streamer_port}`, '-RenderOffscreen', '-log', '-AllowPixelStreamingCommands', '-PixelStreamingEncoderMinQP=20', '-PixelStreamingEncoderMaxQP=10', '-PixelStreamingWebRTCDisableReceiveAudio', '-PixelStreamingWebRTCDisableTransmitAudio']
      const command = `${exePath} ${args.join(' ')}`;
      const childProcess = exec(command);

      // Listen for the 'exit' event
      childProcess.on("exit", (code) => {
        console.log(`Child process exited with code ${code}`);
      });

      // Listen for the 'error' event
      childProcess.on("error", (err) => {
        console.error("Error occurred:", err);
      });

      // Listen for the child process's stderr
      childProcess.stderr.on("data", (data) => {
        console.error(`Child process stderr: ${data}`);
      });
      batchPID = childProcess.pid;
      console.logColor(batchPID);
    });
  });
};

function AssignPlayerId(playerId) {
  console.logColor("batchIDs", batchPID);
  batchMap.set(playerId, batchPID);
  db.query(`SELECT id FROM ports WHERE https_port=${httpsPort}`, (error, results) => {
    console.log("db playerid");
    if (error) {
      console.error('Error querying the database:', error);
      return;
    }
    console.log(results[0].id, 'from ports');
    db.query(`SELECT id FROM sessions WHERE ports_id=${results[0].id}`, (error, results) => {
      if (error) {
        console.error('Error querying the database:', error);
        return;
      }
      console.log(results[0].id, 'from sessions');
      db.query(`UPDATE active_users SET client_exe_pid = ${batchPID}, webrtc_player_id = ${playerId} WHERE session_id=${results[0].id} ORDER BY id DESC
        LIMIT 1`, (error) => {
        if (error) {
          console.error('Error querying the database:', error);
          return;
        }
        console.log(JSON.stringify(results), 'result from');
      });
    });
  });
  console.logColor("assign", batchMap.get(playerId));
}
function killBatchProcess(playerId) {
  let plr = [];
  plr.push(playerId);
  for (let i = 0; i < batchPID.length; i++) {
    batchMap.set(plr[i], batchPID[i]);
  }
  let pid = batchMap.get(playerId);
  console.logColor("kill", batchMap.get(playerId));
  for (const [key, value] of batchMap) {
    console.logColor(`${key} => ${value}`);
  }
  treeKill(pid, "SIGTERM", (err) => {
    if (err) {
      console.error(`Error killing process: ${err.message}`);
    } else {
      console.log("Process terminated successfully");
    }
  });
}
// Request has been sent to site root, send the homepage file
app.get(
  "/player.html?hoveringMouse=true&ForceTURN=true&preferSFU=true",
  isAuthenticated("/login"),
  function (req, res) {
    homepageFile =
      typeof config.HomepageFile != "undefined" && config.HomepageFile != ""
        ? config.HomepageFile.toString()
        : defaultConfig.HomepageFile;

    let pathsToTry = [
      path.join(__dirname, homepageFile),
      path.join(__dirname, "/Public", homepageFile),
      path.join(__dirname, "/custom_html", homepageFile),
      homepageFile,
    ];

    // Try a few paths, see if any resolve to a homepage file the user has set
    for (let pathToTry of pathsToTry) {
      if (fs.existsSync(pathToTry)) {
        // Send the file for browser to display it
        res.sendFile(pathToTry);
        return;
      }
    }

    // Catch file doesn't exist, and send back 404 if not
    console.error("Unable to locate file " + homepageFile);
    res.status(404).send("Unable to locate file " + homepageFile);
    return;
  });

// const apiKey = "CJLXWcjbZIld8lA5OK6HItlkNUc";
// const shopDomain = "metshopy.myshopify.com";
// const externalId = "8179869974825"; //shopify product id
// const productIds = [];
// let internal_product_id;
// let fetchData = async (product_id, reviews_number, page_number) => {
//   try {
//     let getInternalId = await fetch(
//       `https://judge.me/api/v1/products/-1?external_id=${product_id}&api_token=${apiKey}&shop_domain=${shopDomain}`
//     )
//       .then((res) => res.json())
//       .then((data) => {
//         productIds.push(data.product.id);
//       });

//     const getReviews = await fetch(
//       `https://judge.me/api/v1/reviews?product_id=${productIds[0]}&api_token=${apiKey}&shop_domain=${shopDomain}&per_page=${reviews_number}&page=${page_number}`
//     );

//     const data = await getReviews.json();

//     const getAllRatings = await fetch(
//       `https://judge.me/api/v1/reviews?product_id=${productIds[0]}&api_token=${apiKey}&shop_domain=${shopDomain}&per_page=100000`
//     );

//     const allRating = await getAllRatings.json();
//     let ratings = [];

//     for (const review of allRating.reviews) {
//       ratings.push(review.rating);
//     }

//     const totalreviews = ratings.length;
//     const sum = ratings.reduce((a, b) => a + b, 0);
//     const avg = sum / ratings.length;

//     console.log(ratings);
//     console.log("Avg: " + avg);
//     console.log("totalreviews" + totalreviews);

//     return {
//       reviews: data.reviews,
//       allRating: totalreviews,
//       averageRating: avg,
//     };
//   } catch (error) {
//     console.log(error);
//   }
// };
// app.get("/api/reviews", async (req, res) => {
//   try {
//     let productId = req.query.id;
//     let reviews_number = req.query.per_page;
//     let page_number = req.query.page;

//     const data = await fetchData(productId, reviews_number, page_number);

//     res.send(
//       JSON.stringify({
//         reviews: data.reviews,
//         allRating: data.allRating,
//         averageRating: data.averageRating,
//       })
//     );
//   } catch (error) {
//     console.log(error);
//   }
// });

const apiKey = "CJLXWcjbZIld8lA5OK6HItlkNUc";
const shopDomain = "metshopy.myshopify.com";

const isValidProductId = (product) => {
  return product && product.id;
};

class ReviewDTO {
  constructor(reviews, allRating, averageRating) {
    this.reviews = reviews;
    this.allRating = allRating;
    this.averageRating = averageRating;
  }
}

const fetchData = async (product_id, per_page, page) => {
  try {
    const response = await fetch(
      `https://judge.me/api/v1/products/-1?external_id=${product_id}&api_token=${apiKey}&shop_domain=${shopDomain}`
    );
    const productData = await response.json();

    if (!isValidProductId(productData.product)) {
      throw new Error("Wrong Product ID");
    }

    const getReviews = await fetch(
      `https://judge.me/api/v1/reviews?product_id=${productData.product.id}&api_token=${apiKey}&shop_domain=${shopDomain}&per_page=${per_page}&page=${page}`
    );
    const reviewData = await getReviews.json();

    const getAllRatings = await fetch(
      `https://judge.me/api/v1/reviews?product_id=${productData.product.id}&api_token=${apiKey}&shop_domain=${shopDomain}&per_page=100000`
    );
    const allRatingData = await getAllRatings.json();

    const ratings = allRatingData.reviews.map((review) => review.rating);

    const totalReviews = ratings.length;
    const sum = ratings.reduce((a, b) => a + b, 0);
    const avg = sum / totalReviews;

    const reviewDTO = new ReviewDTO(reviewData, totalReviews, avg);
    return reviewDTO;
  } catch (error) {
    console.log(error);
    throw new Error("Internal Server Error");
  }
};

app.get("/api/reviews", async (req, res) => {
  try {
    const product_id = parseInt(req.query.product_id);
    const per_page = parseInt(req.query.per_page);
    const page = parseInt(req.query.page);
    const response = await fetchData(product_id, per_page, page);
    res.send(response);
  } catch (error) {
    console.log(error);
    if (error.message === "Wrong Product ID") {
      res.status(401).send("Wrong Product ID");
    } else {
      res.status(500).send("Internal Server Error");
    }
  }
});

let postReviews = async (product_id, payload) => {
  const apiKey = "CJLXWcjbZIld8lA5OK6HItlkNUc";
  const shopDomain = "metshopy.myshopify.com";
  try {
    const options = {
      method: "POST",
      body: JSON.stringify({
        shop_domain: "metshopy.myshopify.com",
        platform: "shopify",
        id: `${product_id}`,
        email: payload.email,
        name: payload.name,
        rating: payload.rating,
        title: payload.title,
        body: payload.body,
      }),
      headers: {
        "Content-type": "application/json; charset=UTF-8",
      },
    };
    const response = await fetch(
      `https://judge.me/api/v1/reviews?api_token=${apiKey}&shop_domain=${shopDomain}`,
      options
    );
    const json = await response.json();
    return json;
  } catch (error) {
    // res.status(500).json({ error: 'Internal Server Error' });
  }
};

app.post("/api/post/reviews/:productId/:payload", async (req, res) => {
  try {
    let productId = req.params.productId;
    const data = await postReviews(productId, JSON.parse(req.params.payload));
    res.send(data);
  } catch (error) {
    console.log(error);
  }
});

let relatedProduct = async (product_Id) => {
  const apikey = "645a78-01a058-e5186b-5c4dab-c55fe3";
  const shopedomain = "metshopy.myshopify.com";
  try {
    const response = await fetch(
      `https://wiser.expertvillagemedia.com/api/related-products?shop=${shopedomain}&api_key=${apikey}&product_id=${product_Id}`
    );
    const json = await response.json();
    console.log(json);

    return json;
  } catch (error) {
    console.error(error);
    // res.status(500).json({ error: 'Internal Server Error' });
  }
};

app.get("/api/related/products/:productId", async (req, res) => {
  try {
    let productId = req.params.productId;
    const data = await relatedProduct(productId);
    // console.log(data);
    res.send(data);
  } catch (error) {
    console.log(error);
  }
});

let frequentlybought = async (product_Id) => {
  const apikey = "645a78-01a058-e5186b-5c4dab-c55fe3";
  const shopedomain = "metshopy.myshopify.com";
  try {
    const response = await fetch(
      `https://wiser.expertvillagemedia.com/api/frequentlybought-products?shop=${shopedomain}&api_key=${apikey}&product_id=${product_Id}`
    );
    const json = await response.json();
    console.log(json);

    return json;
  } catch (error) {
    console.error(error);
    // res.status(500).json({ error: 'Internal Server Error' });
  }
};

app.get("/api/frequentlybought/products/:productId", async (req, res) => {
  try {
    let productId = req.params.productId;
    const data = await frequentlybought(productId);
    res.send(data);
  } catch (error) {
    console.log(error);
  }
});

const shopifyCred = new Shopify({
  shopName: "metshopy.myshopify.com",
  apiKey: "893e616e50ff70fa50ae43f28ca9f4bb",
  password: "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",
});

const orderId = 5353851486505;

const getData = async () => {
  try {
    const data = [];
    const order = await shopifyCred.order.get(orderId, {
      fields: ["id", "line_items"],
    });
    const lineItems = order.line_items;
    for (const item of lineItems) {
      const product = await shopifyCred.product.get(item.product_id);
      const variants = product.variants;
      const variant = variants.find((v) => v.id === item.variant_id);
      const variantColor = variant?.option2 || "";
      const variantSize = variant?.option1 || "";
      const imageSrc =
        (variant && variant.variant_image) ||
        (product.images.length > 0 ? product.images[1].src : ""); // Use variant image if available, otherwise use first product image
      const productData = {
        product_id: item.product_id,
        title: item.title,
        price: item.price,
        variantId: item.variant_id,
        variantColor: variantColor,
        variantSize: variantSize,
        imageSrcs: [imageSrc],
      };
      data.push(productData);
    }
    return { orders: data };
  } catch (err) {
    console.error(err);
  }
};
//get past orders
app.get("/past-orders", async (req, res) => {
  try {
    const data = await getData();
    res.send(JSON.stringify(data));
  } catch (err) {
    res.status(500).send("Error retrieving data");
  }
});

// Login
app.use(express.json());

class LoginDTO {
  constructor(email, password) {
    this.email = email;
    this.password = password;
  }
}

async function createCustomerAccessToken(loginDTO) {
  try {
    const { email, password } = loginDTO;

    const response = await axios.post(
      "https://metshopy.myshopify.com/api/graphql.json",
      {
        query: `
        mutation {
          customerAccessTokenCreate(input: {
            email: "${email}"
            password: "${password}"
          }) {
            customerAccessToken {
              accessToken
              expiresAt
            }
            userErrors {
              field
              message
            }
          }
        }
      `,
      },
      {
        headers: {
          "X-Shopify-Storefront-Access-Token":
            "a8e1b986e492b696cc3dfa25cbf6e26d",
          "Content-Type": "application/json",
        },
      }
    );

    const { customerAccessToken, userErrors } =
      response.data.data.customerAccessTokenCreate;
    if (customerAccessToken) {
      return {
        // accessToken: customerAccessToken.accessToken,
        // expiresAt: customerAccessToken.expiresAt,
        customerAccessToken: customerAccessToken,
      };
    } else {
      return userErrors;
    }
  } catch (error) {
    return "Something went wrong";
  }
}

// LOGIN
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const loginDTO = new LoginDTO(email, password);
    const result = await createCustomerAccessToken(loginDTO);

    res.status(200).json(result);
  } catch (error) {
    res.status(401).json({
      status: "FAILED",
      message: "Authentication failed. Please check your email and password",
    });
  }
});

// Start User Details API

class UserDetailsDTO {
  constructor(id, firstName, lastName, email, phone, profileImage) {
    this.id = parseInt(id.replace("gid://shopify/Customer/", ""));
    this.firstName = firstName;
    this.lastName = lastName;
    this.email = email;
    this.phone = phone;
    this.profileImage = profileImage || null;
  }
}

async function userDetails(customerAccessToken) {
  try {
    const customerResponse = await axios.post(
      "https://metshopy.myshopify.com/api/graphql.json",
      {
        query: `
          query {
            customer(customerAccessToken: "${customerAccessToken}") {
              id
              firstName
              lastName
              email
              phone
            }
          }
        `,
      },
      {
        headers: {
          "X-Shopify-Storefront-Access-Token":
            "a8e1b986e492b696cc3dfa25cbf6e26d",
          "Content-Type": "application/json",
        },
      }
    );

    const { customer } = customerResponse.data.data;
    const userDetailsDTO = new UserDetailsDTO(
      customer.id,
      customer.firstName,
      customer.lastName,
      customer.email,
      customer.phone
    );

    const id = userDetailsDTO.id;
    localStorage.setItem("customer", id);
    console.log("customer id 11", id);

    const url = `https://metshopy.myshopify.com/admin/api/2023-04/customers/${id}/metafields.json`;
    const headers = {
      "X-Shopify-Access-Token": "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",
    };

    const profileImageResponse = await axios.get(url, { headers });
    const profileImageData = profileImageResponse.data;

    if (profileImageData.metafields.length > 0) {
      const profileImage = profileImageData.metafields[0].value;
      userDetailsDTO.profileImage = profileImage;
    }
    return {
      userDetails: userDetailsDTO,
    };
  } catch (error) {
    throw error;
  }
}

app.post("/userdetails/:token", async (req, res) => {
  const token = req.params.token;
  try {
    const result = await userDetails(token);
    res.status(200).json(result);
  } catch (error) {
    res.status(400).json({ message: "FAILED" });
  }
});

// End User Details API

const shopify3 = new Shopify({
  shopName: "metshopy.myshopify.com",
  apiKey: "893e616e50ff70fa50ae43f28ca9f4bb",
  password: "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",
});

class OrderDTO {
  constructor(
    orderId,
    orderUpdatedAt,
    shipTo,
    paymentMethod,
    productId,
    title,
    quantity,
    price,
    variantId,
    variantSize,
    variantColor,
    imageSrc,
    taxAmount
  ) {
    this.orderId = orderId;
    this.orderUpdatedAt = orderUpdatedAt;
    this.shipTo = shipTo;
    this.paymentMethod = paymentMethod;
    this.productId = productId;
    this.title = title;
    this.quantity = quantity;
    this.price = price;
    this.variantId = variantId;
    this.variantSize = variantSize;
    this.variantColor = variantColor;
    this.imageSrc = imageSrc;
    this.taxAmount = taxAmount;
  }
}

const validateCustomerId = (customerId) => {
  if (!customerId || isNaN(customerId)) {
    throw new Error("Invalid customerId. Please provide a valid number.");
  }
};

const fetchOrderDetails = async (customerId) => {
  try {
    validateCustomerId(customerId);

    const orders = await shopify3.order.list({ customer_id: customerId });

    if (orders.length === 0) {
      return null;
    }

    const data = [];
    for (const order of orders) {
      const orderId = order.id;
      const orderUpdatedAt = order.updated_at || null;
      const shippingAddress = order.shipping_address || null;
      const paymentMethod = order.payment_gateway_names || null;

      for (const item of order.line_items) {
        const product = await shopify3.product.get(item.product_id);
        const variants = product.variants;
        const variant = variants.find((v) => v.id === item.variant_id);
        const variantSize = variant?.option1 || "";
        const variantColor = variant?.option2 || "";
        const imageSrc =
          variant?.image ||
          (product.images.length > 0 ? product.images[0].src : "");
        const taxAmount = item.tax_lines;

        const productData = new OrderDTO(
          orderId,
          orderUpdatedAt,
          shippingAddress,
          paymentMethod,
          item.product_id,
          item.title,
          item.quantity,
          item.price,
          item.variant_id,
          variantSize,
          variantColor,
          imageSrc,
          taxAmount
        );

        data.push(productData);
      }
    }
    return data;
  } catch (err) {
    console.error(err);
    throw new Error("Error retrieving order details");
  }
};

app.get("/api/past/orders", async (req, res) => {
  try {
    const customerId = Number(req.query.customerId);
    validateCustomerId(customerId);

    const data = await fetchOrderDetails(customerId);
    if (data === null) {
      res.json(null);
    } else {
      res.json(data);
    }
  } catch (err) {
    console.error(err);
    res.status(500).send("Error retrieving data");
  }
});

function mapAvatarToDTO(avatar) {
  return {
    session_uuid: avatar.session_uuid,
    created_at: avatar.updated_at,
    url: avatar.url,
    location: avatar.location,
  };
}

app.get('/sessions-and-avatars/:customerId', async (req, res) => {
  const customerId = req.params.customerId;

  if (!isNaN(customerId)) {
    const query = `SELECT avatars.*, sessions.* FROM avatars LEFT JOIN sessions ON avatars.session_uuid = sessions.session_uuid WHERE avatars.customer_id = ? AND avatars.session_uuid = sessions.session_uuid ORDER BY updated_at DESC;`;

    db.query(query, [customerId], async (err, results) => {
      if (err) {
        console.error('Error executing the query:', err);
        res.status(500).json({ error: 'An error occurred' });
      }
      else {
        if (results.length === 0) {
          res.status(404).json({ message: 'No avatars found for the specified customer' });
        }
        else {
          const avatarsDTO = results.map(mapAvatarToDTO);
          res.status(200).json(avatarsDTO);
        }
      }
    });
  } else {
    res.status(400).json({ error: 'Invalid customerId' });
  }
});

class AvatarRequestDTO {
  constructor(customer_id, session_uuid, url, data) {
    this.customer_id = customer_id;
    this.session_uuid = session_uuid;
    this.url = url;
    this.data = data;
  }
}

class AvatarResponseDTO {
  constructor(message, location) {
    this.message = message;
    this.location = location;
  }
}

app.post('/save-and-exit', (req, res) => {
  // Use AvatarRequestDTO to parse the request body
  const requestBody = req.body;
  const avatarRequest = new AvatarRequestDTO(
    requestBody.customer_id,
    requestBody.session_uuid,
    requestBody.url,
    requestBody.data
  );

  // Check the AvatarRequestDTO and perform database operations
  const { customer_id, session_uuid, url, data } = avatarRequest;

  const selectQuery = `SELECT count(*) as count FROM avatars WHERE session_uuid = ? AND customer_id = ?`;
  db.query(selectQuery, [session_uuid, customer_id], (err, results) => {
    if (err) {
      console.error('Error executing query:', err);
      res.status(500).json({ error: 'An error occurred while executing the query' });
      return;
    }

    if (results[0].count > 0) {
      // Data exists for the given customer_id and session_uuid, so update it.
      const updateQuery = 'UPDATE avatars SET location = ? WHERE session_uuid = ? AND customer_id = ?';
      db.query(updateQuery, [data, session_uuid, customer_id], (err, updateResults) => {
        if (err) {
          console.error('Error updating data:', err);
          res.status(500).json({ error: 'An error occurred while updating data' });
          return;
        }
        console.log('Data updated successfully');
        const updatedLocation = data; // You can replace this with the actual updated location
        const avatarResponse = new AvatarResponseDTO('Data updated successfully', updatedLocation);
        res.status(200).json(avatarResponse);
      });
    } else {
      // Data doesn't exist, so insert it.
      const insertQuery = `INSERT INTO avatars (customer_id, session_uuid, url, location) VALUES (?, ?, ?, ?)`;
      db.query(insertQuery, [customer_id, session_uuid, url, data], (err, insertResults) => {
        if (err) {
          console.error('Error inserting data:', err);
          res.status(500).json({ message: 'An error occurred while inserting data.' });
          return;
        }
        console.log('Data inserted successfully');
        const avatarResponse = new AvatarResponseDTO('Data inserted successfully', data);
        res.status(201).json(avatarResponse);
      });
    }
  });
});

//Setup http and https servers
http.listen(httpPort, function () {
  console.logColor(logging.Green, "Http listening on *: " + httpPort);
});

if (config.UseHTTPS) {
  https.listen(httpsPort, function () {
    console.logColor(logging.Green, "Https listening on *: " + httpsPort);
  });
}

console.logColor(
  logging.Cyan,
  `Running Cirrus - The Pixel Streaming reference implementation signalling server for Unreal Engine 5.1.`
);

let nextPlayerId = 100; // reserve some player ids
let SFUPlayerId = "1"; // sfu is a special kind of player
//let streamer;
let nextStreamerId = 0;
const streamers = new Map();
let sfu = null; // WebSocket connected to SFU
let players = new Map(); // playerId <-> player, where player is either a web-browser or a native webrtc player

function sfuIsConnected() {
  // let sfu = sfus.get(SFUPlayerId);
  // return sfu && sfu.ws.readyState == 1;
  return sfu && sfu.readyState == 1;
}

function logIncoming(sourceName, msgType, msg) {
  if (config.LogVerbose)
    console.logColor(
      logging.Blue,
      "\x1b[37m-> %s\x1b[34m: %s",
      sourceName,
      msg
    );
  else
    console.logColor(
      logging.Blue,
      "\x1b[37m-> %s\x1b[34m: %s",
      sourceName,
      msgType
    );
}

function logOutgoing(destName, msgType, msg) {
  if (config.LogVerbose)
    console.logColor(logging.Green, "\x1b[37m<- %s\x1b[32m: %s", destName, msg);
  else
    console.logColor(
      logging.Green,
      "\x1b[37m<- %s\x1b[32m: %s",
      destName,
      msgType
    );
}

// normal peer to peer signalling goes to streamer. SFU streaming signalling goes to the sfu
function sendMessageToController(msg, skipSFU, skipStreamer = false, streamerId) {

  let streamer = streamers.get(streamerId);
  const rawMsg = JSON.stringify(msg);

  if (sfu && sfu.readyState == 1 && !skipSFU) {
    logOutgoing(`SFU ${SFUPlayerId}`, msg.type, rawMsg);
    sfu.ws.send(rawMsg);
  }

  if (streamer && streamer.playerId && !skipStreamer) {
    logOutgoing(`Streamer ${streamer.id}`, msg.type, rawMsg);
    //console.log(util.inspect(streamer.ws, { showHidden: false, depth: null }), 'st');
    streamer.ws.send(rawMsg);
  }
  //console.logColor(streamer.ws.readyState, 'sww');

  if (!sfu && !streamer) {
    console.error(
      "sendMessageToController: No streamer or SFU connected!\nMSG: %s",
      rawMsg
    );
  }
}

function sendMessageToPlayer(playerId, msg) {
  let player = players.get(playerId);
  if (!player) {
    console.log(
      `dropped message ${msg.type} as the player ${playerId} is not found`
    );
    return;
  }
  const playerName = playerId == SFUPlayerId ? "SFU" : `player ${playerId}`;
  const rawMsg = JSON.stringify(msg);
  logOutgoing(playerName, msg.type, rawMsg);
  player.ws.send(rawMsg);
}

let WebSocket = require("ws");
const { URL } = require("url");
const { logColor, Console } = require("console");

console.logColor(
  logging.Green,
  `WebSocket listening for Streamer connections on :${streamerPort}`
);
//let surl = "http://127.0.0.1:8888"


//Streamer sending webRTC offers

let streamerServer = new WebSocket.Server({ port: streamerPort });
//let streamerServer = new WebSocket.Server({ server:surl });
streamerServer.on("connection", function (ws, req) {
  //Store the WebSocket connection with the streamer ID
  let streamerId = (++nextStreamerId).toString();
  console.logColor(
    logging.Green,
    `Streamer ${streamerId} connected: ${req.connection.remoteAddress}`
  );

  streamers.set(streamerId, { ws: ws, id: streamerId });


  //console.log(util.inspect(streamer.ws, { showHidden: false, depth: null }));
  if (streamers.size == maxPlayerCount && maxPlayerCount !== -1) {
    sendSpaceIsFullToMatchmaker();
  }
  else {
    sendSpaceInRoomToMatchmaker();
  }



  ws.on("message", (msgRaw) => {
    var msg;
    try {
      msg = JSON.parse(msgRaw);

    } catch (err) {
      console.error(`cannot parse Streamer message: ${msgRaw}\nError: ${err}`);
      ws.close(1008, "Cannot parse");
      return;
    }

    logIncoming(`Streamer ${streamerId}`, msg.type, msgRaw);


    try {
      // just send pings back to sender
      if (msg.type == "ping") {
        const rawMsg = JSON.stringify({ type: "pong", time: msg.time });
        logOutgoing(`Streamer ${streamerId}`, msg.type, rawMsg);
        ws.send(rawMsg);
        return;
      }

      // Convert incoming playerId to a string if it is an integer, if needed. (We support receiving it as an int or string).
      let playerId = msg.playerId;
      if (playerId && typeof playerId === "number") {
        playerId = playerId.toString();
      }

      delete msg.playerId; // no need to send it to the player
      //console.logColor(streamerId, 'sssss');


      if (msg.type == "offer") {
        msg.streamerId = streamerId;
        sendMessageToPlayer(playerId, msg);
      } else if (msg.type == "answer") {
        msg.streamerId = streamerId;
        sendMessageToPlayer(playerId, msg);

      } else if (msg.type == "iceCandidate") {
        msg.streamerId = streamerId;
        sendMessageToPlayer(playerId, msg);

      } else if (msg.type == "disconnectPlayer") {
        let player = players.get(playerId);
        if (player) {
          player.ws.close(1011 /* internal error */, msg.reason);
        }
      } else {
        console.error(`unsupported Streamer message type: ${msg.type}`);
      }
    } catch (err) {
      console.error(`ERROR: ws.on message error: ${err.message}`);
    }
  });

  function onStreamerDisconnected() {
    //sendStreamerDisconnectedToMatchmaker();
    sendSpaceInRoomToMatchmaker();
    disconnectAllPlayers();
    if (sfuIsConnected()) {
      const msg = { type: "streamerDisconnected" };
      //let sfu = sfus.get(SFUPlayerId);
      sfu.send(JSON.stringify(msg));
    }
    streamers.delete(streamerId);
  }

  ws.on("close", function (code, reason) {
    //console.log('Client', clientId, 'disconnected');
    console.error(`streamer ${streamerId} disconnected: ${code} - ${reason}`);
    onStreamerDisconnected();
  });

  ws.on("error", function (error) {
    console.error(`streamer connection error: ${error}`);
    onStreamerDisconnected();
    try {
      ws.close(1006 /* abnormal closure */, error);
    } catch (err) {
      console.error(`ERROR: ws.on error: ${err.message}`);
    }
  });

  ws.send(JSON.stringify(clientConfig));

  if (sfuIsConnected()) {
    const msg = {
      type: "playerConnected",
      playerId: SFUPlayerId,
      dataChannel: true,
      sfu: true,
    };
    ws.send(JSON.stringify(msg));
  }
});

console.logColor(
  logging.Green,
  `WebSocket listening for SFU connections on :${sfuPort}`
);
let sfuServer = new WebSocket.Server({ port: sfuPort });
sfuServer.on('connection', function (ws, req) {
  // reject if we already have an sfu
  if (sfuIsConnected()) {
    ws.close(1013, 'Already have SFU');
    return;
  }

  //++SFUPlayerId;
  players.set(SFUPlayerId, { ws: ws, id: SFUPlayerId });

  //streamer = streamers.get(streamerId);

  ws.on('message', (msgRaw) => {
    var msg;
    try {
      msg = JSON.parse(msgRaw);
    } catch (err) {
      console.error(`cannot parse SFU message: ${msgRaw}\nError: ${err}`);
      ws.close(1008, 'Cannot parse');
      return;
    }

    logIncoming("SFU", msg.type, msgRaw);

    if (msg.type == 'offer') {
      // offers from the sfu are for players
      const playerId = msg.playerId;
      delete msg.playerId;
      console.log(playerId, 'player');
      sendMessageToPlayer(playerId, msg);
    }
    else if (msg.type == 'answer') {
      // answers from the sfu are for the streamer
      msg.playerId = SFUPlayerId;
      const rawMsg = JSON.stringify(msg);
      logOutgoing("Streamer", msg.type, rawMsg);
      streamer.ws.send(rawMsg);
    }
    else if (msg.type == 'streamerDataChannels') {
      // sfu is asking streamer to open a data channel for a connected peer
      msg.sfuId = SFUPlayerId;
      const rawMsg = JSON.stringify(msg);
      logOutgoing("Streamer", msg.type, rawMsg);
      streamer.ws.send(rawMsg);
    }
    else if (msg.type == 'peerDataChannels') {
      // sfu is telling a peer what stream id to use for a data channel
      const playerId = msg.playerId;
      delete msg.playerId;
      sendMessageToPlayer(playerId, msg);
      // remember the player has a data channel
      const player = players.get(playerId);
      player.datachannel = true;
    }
  });

  ws.on('close', function (code, reason) {
    console.error(`SFU disconnected: ${code} - ${reason}`);
    sfu = null;
    disconnectSFUPlayer();
  });

  ws.on('error', function (error) {
    console.error(`SFU connection error: ${error}`);
    sfu = null;
    disconnectSFUPlayer();
    try {
      ws.close(1006 /* abnormal closure */, error);
    } catch (err) {
      console.error(`ERROR: ws.on error: ${err.message}`);
    }
  });

  sfu = ws;
  console.logColor(logging.Green, `SFU (${req.connection.remoteAddress}) connected `);



  if (streamer && streamer.ws.readyState == 1) {
    const msg = { type: "playerConnected", playerId: SFUPlayerId, dataChannel: true, sfu: true };
    streamer.ws.send(JSON.stringify(msg));
  }
});

let playerCount = 0;

function InsertPlayerCountToDb(playerCount) {
  if (httpsPort != '447') {
    db.query(`SELECT id from ports WHERE https_port = '${httpsPort}' AND is_used = 1`, (error, results) => {
      if (error) {
        console.error('Error querying the database:', error);
        return;
      }
      db.query(`UPDATE sessions SET number_of_players = ${playerCount} WHERE ports_id = ${results[0].id}`, (error) => {
        if (error) {
          console.error('Error querying the database:', error);
          return;
        }
        console.log(results[0].id, 'id');
      });
    });
  }
}

function RemoveFromDb(playerId) {
  // db.query(`SELECT id from ports WHERE https_port = '${httpsPort}' AND is_used = 1`, (error, portresults) => {
  //   if (error) {
  //     console.error('Error querying the database:', error);
  //     return;
  //   }
  //   console.log(JSON.stringify(portresults[0]),'from ports');
  //   db.query(`SELECT id from sessions WHERE ports_id = ${portresults[0].id}`, (error, sessionresults) => {
  //     if (error) {
  //       console.error('Error querying the database:', error);
  //       return;
  //     }
  //     console.log(JSON.stringify(sessionresults[0]),'form sessions');
  //     db.query(`DELETE from active_users WHERE webrtc_player_id = ${playerId} AND session_id = ${sessionresults[0].id}`, (error, results) => {
  //       if (error) {
  //         console.error('Error querying the database:', error);
  //         return;
  //       }
  //       console.log(JSON.stringify(results[0]),'from active_users');
  //     });
  //   });
  // });
}

console.logColor(
  logging.Green,
  `WebSocket listening for Players connections on :${httpPort}`
);

let playerServer = new WebSocket.Server({
  server: config.UseHTTPS ? https : http,
});

playerServer.on("connection", function (ws, req) {

  let connect;
  let stream;
  streamers.forEach((value, key) => {
    if (!value.playerId) {
      connect = key;
      stream = streamers.get(key);
    }
  });
  if (!connect) {
    ws.close(1013 /* Try again later */, "Streamer is not connected");
    return false;
  }

  var url = require("url");
  const parsedUrl = url.parse(req.url);
  const urlParams = new URLSearchParams(parsedUrl.search);
  const preferSFU =
    urlParams.has("preferSFU") && urlParams.get("preferSFU") !== "false";
  const skipSFU = !preferSFU;
  const skipStreamer = preferSFU && sfu;
  //let streamerId;

  if (preferSFU && !sfu) {
    ws.send(
      JSON.stringify({
        type: "warning",
        warning:
          "Even though ?preferSFU was specified, there is currently no SFU connected.",
      })
    );
  }

  if (playerCount === maxPlayerCount && maxPlayerCount !== -1) {
    console.logColor(
      logging.Red,
      `new connection would exceed number of allowed concurrent connections. Max: ${maxPlayerCount}, Current ${playerCount}`
    );
    ws.close(
      1013,
      `The room already has maximum number of players.
      Please try joining after sometime!`
    );
    return;
  }

  ++playerCount;
  let playerId = (++nextPlayerId).toString();
  console.logColor(
    logging.Green,
    `player ${playerId} (${req.connection.remoteAddress}) connected`
  );

  InsertPlayerCountToDb(playerCount)

  players.set(playerId, { ws: ws, id: playerId });
  if (stream.playerId === undefined) {
    console.log(stream.id, 'raw');
    streamers.set(stream.id, { ws: stream.ws, id: stream.id, playerId: playerId });
  }

  function sendPlayersCount() {
    let playerCountMsg = JSON.stringify({
      type: "playerCount",
      count: players.size,
    });
    for (let p of players.values()) {
      p.ws.send(playerCountMsg);
    }
  }

  ws.on("message", (msgRaw) => {
    var msg;
    try {
      msg = JSON.parse(msgRaw);

    } catch (err) {
      console.error(
        `cannot parse player ${playerId} message: ${msgRaw}\nError: ${err}`
      );
      ws.close(1008, "Cannot parse");
      return;
    }

    if (!msg || !msg.type) {
      console.error(`Cannot parse message ${msgRaw}`);
      return;
    }

    let streamerId = msg.streamerId;
    if (streamerId && typeof streamerId === "number") {
      streamerId = streamerId.toString();
    }

    //delete msg.streamerId;

    logIncoming(`player ${playerId}`, msg.type, msgRaw);

    if (msg.type == "offer") {
      msg.playerId = playerId;
      //console.logColor(streamerId, 'sttid');
      sendMessageToController(msg, skipSFU, streamerId);
    } else if (msg.type == "answer") {
      msg.playerId = playerId;
      //console.log(streamerId, 'stId');
      sendMessageToController(msg, skipSFU, skipStreamer, stream.id);
    } else if (msg.type == "iceCandidate") {
      msg.playerId = playerId;
      //console.logColor(JSON.stringify(msg), 'm');
      sendMessageToController(msg, skipSFU, skipStreamer, stream.id);
    } else if (msg.type == "stats") {
      console.log(`player ${playerId}: stats\n${msg.data}`);
    } else if (msg.type == "dataChannelRequest") {
      msg.playerId = playerId;
      //console.logColor(JSON.stringify(msg), 'm');
      sendMessageToController(msg, skipSFU, true, streamerId);
    } else if (msg.type == "peerDataChannelsReady") {
      msg.playerId = playerId;
      sendMessageToController(msg, skipSFU, true, streamerId);
    } else {
      console.error(
        `player ${playerId}: unsupported message type: ${msg.type}`
      );
      return;
    }
  });

  function onPlayerDisconnected() {
    try {
      --playerCount;
      InsertPlayerCountToDb(playerCount);
      const player = players.get(playerId);
      if (player.datachannel) {
        // have to notify the streamer that the datachannel can be closed
        sendMessageToController(
          { type: "playerDisconnected", playerId: playerId },
          true,
          false,
          stream.id
        );
      }
      players.delete(playerId);
      RemoveFromDb(playerId);
      RemoveStreamerFromMap(playerId);
      sendMessageToController(
        { type: "playerDisconnected", playerId: playerId },
        skipSFU,
        stream.id
      );
      sendPlayerDisconnectedToFrontend();
      sendPlayerDisconnectedToMatchmaker();
      killBatchProcess(playerId);
      //handlePlayerDisconnect(playerId)
      sendPlayersCount();
    } catch (err) {
      console.logColor(
        logging.Red,
        `ERROR:: onPlayerDisconnected error: ${err.message}`
      );
    }
  }

  function RemoveStreamerFromMap(playerId) {
    let deletePlayer;
    streamers.forEach((value, key) => {
      if (value.playerId === playerId) {
        deletePlayer = key;
      }
    });
    //console.log(deletePlayer, 'del');
    if (deletePlayer) {
      streamers.delete(deletePlayer);
    }
  }
  ws.on("close", function (code, reason) {
    console.logColor(
      logging.Yellow,
      `player ${playerId} connection closed: ${code} - ${reason}`
    );
    onPlayerDisconnected();
  });

  ws.on("error", function (error) {
    console.error(`player ${playerId} connection error: ${error}`);
    ws.close(1006 /* abnormal closure */, error);
    onPlayerDisconnected();

    console.logColor(logging.Red, `Trying to reconnect...`);
    reconnect();
  });

  sendPlayerConnectedToFrontend();
  sendPlayerConnectedToMatchmaker();

  ws.send(JSON.stringify(clientConfig));

  sendMessageToController(
    {
      type: "playerConnected",
      playerId: playerId,
      dataChannel: true,
      sfu: false,
    },
    skipSFU,
    skipStreamer,
    stream.id
  );
  AssignPlayerId(playerId);
  sendPlayersCount();
});
function disconnectAllPlayers() {
  //console.log("killing all players");
  let playerId = (++nextPlayerId).toString();
  if (players.has(playerId)) {
    players.get(playerId).ws.close(4000, `Player ${playerId} Disconnected`);
    players.delete(playerId);
  }
}

function disconnectSFUPlayer() {
  console.log("disconnecting SFU from streamer");
  if (players.has(SFUPlayerId)) {
    players.get(SFUPlayerId).ws.close(4000, "SFU Disconnected");
    players.delete(SFUPlayerId);
  }
  sendMessageToController(
    { type: "playerDisconnected", playerId: SFUPlayerId },
    true,
    false,
    stream.id
  );
}

/**
 * Function that handles the connection to the matchmaker.
 */

if (config.UseMatchmaker) {
  var matchmaker = new net.Socket();

  matchmaker.on("connect", function () {
    console.log(
      `Cirrus connected to Matchmaker ${matchmakerAddress}:${matchmakerPort}`
    );

    // message.playerConnected is a new variable sent from the SS to help track whether or not a player
    // is already connected when a 'connect' message is sent (i.e., reconnect). This happens when the MM
    // and the SS get disconnected unexpectedly (was happening often at scale for some reason).
    var playerConnected = false;

    // Set the playerConnected flag to tell the MM if there is already a player active (i.e., don't send a new one here)
    if (players && players.size > 0) {
      playerConnected = true;
    }


    message = {
      type: "connect",
      address:
        typeof serverPublicIp === "undefined" ? "127.0.0.1" : serverPublicIp,
      port: config.UseHTTPS === true ? httpsPort : httpPort,
      ready: true,
      playerConnected: playerConnected,
    };

    matchmaker.write(JSON.stringify(message));

  });

  matchmaker.on("error", (err) => {
    console.log(`Matchmaker connection error ${JSON.stringify(err)}`);
  });

  matchmaker.on("end", () => {
    console.log("Matchmaker connection ended");
  });

  matchmaker.on("close", (hadError) => {
    console.logColor(logging.Blue, "Setting Keep Alive to true");
    matchmaker.setKeepAlive(true, 60000); // Keeps it alive for 60 seconds

    console.log(`Matchmaker connection closed (hadError=${hadError})`);

    reconnect();
  });

  // Attempt to connect to the Matchmaker
  function connect() {
    matchmaker.connect(matchmakerPort, matchmakerAddress);
  }

  // Try to reconnect to the Matchmaker after a given period of time
  function reconnect() {
    console.log(
      `Try reconnect to Matchmaker in ${matchmakerRetryInterval} seconds`
    );
    setTimeout(function () {
      connect();
    }, matchmakerRetryInterval * 1000);
  }

  function registerMMKeepAlive() {
    setInterval(function () {
      message = {
        type: "ping",
      };
      matchmaker.write(JSON.stringify(message));
    }, matchmakerKeepAliveInterval * 1000);
  }

  connect();
  registerMMKeepAlive();
}

//Keep trying to send gameSessionId in case the server isn't ready yet
function sendGameSessionData() {
  //If we are not using the frontend web server don't try and make requests to it
  if (!config.UseFrontend) return;
  webRequest.get(
    `${FRONTEND_WEBSERVER}/server/requestSessionId`,
    function (response, body) {
      if (response.statusCode === 200) {
        gameSessionId = body;
        console.log("SessionId: " + gameSessionId);
      } else {
        console.error("Status code: " + response.statusCode);
        console.error(body);
      }
    },
    function (err) {
      //Repeatedly try in cases where the connection timed out or never connected
      if (err.code === "ECONNRESET") {
        //timeout
        sendGameSessionData();
      } else if (err.code === "ECONNREFUSED") {
        console.error(
          "Frontend server not running, unable to setup game session"
        );
      } else {
        console.error(err);
      }
    }
  );
}

function sendUserSessionData(serverPort) {
  //If we are not using the frontend web server don't try and make requests to it
  if (!config.UseFrontend) return;
  webRequest.get(
    `${FRONTEND_WEBSERVER}/server/requestUserSessionId?gameSessionId=${gameSessionId}&serverPort=${serverPort}&appName=${querystring.escape(
      clientConfig.AppName
    )}&appDescription=${querystring.escape(clientConfig.AppDescription)}${typeof serverPublicIp === "undefined"
      ? ""
      : "&serverHost=" + serverPublicIp
    }`,
    function (response, body) {
      if (response.statusCode === 410) {
        sendUserSessionData(serverPort);
      } else if (response.statusCode === 200) {
        userSessionId = body;
        console.log("UserSessionId: " + userSessionId);
      } else {
        console.error("Status code: " + response.statusCode);
        console.error(body);
      }
    },
    function (err) {
      //Repeatedly try in cases where the connection timed out or never connected
      if (err.code === "ECONNRESET") {
        //timeout
        sendUserSessionData(serverPort);
      } else if (err.code === "ECONNREFUSED") {
        console.error(
          "Frontend server not running, unable to setup user session"
        );
      } else {
        console.error(err);
      }
    }
  );
}

function sendServerDisconnect() {
  //If we are not using the frontend web server don't try and make requests to it
  if (!config.UseFrontend) return;
  try {
    webRequest.get(
      `${FRONTEND_WEBSERVER}/server/serverDisconnected?gameSessionId=${gameSessionId}&appName=${querystring.escape(
        clientConfig.AppName
      )}`,
      function (response, body) {
        if (response.statusCode === 200) {
          console.log("serverDisconnected acknowledged by Frontend");
        } else {
          console.error("Status code: " + response.statusCode);
          console.error(body);
        }
      },
      function (err) {
        //Repeatedly try in cases where the connection timed out or never connected
        if (err.code === "ECONNRESET") {
          //timeout
          sendServerDisconnect();
        } else if (err.code === "ECONNREFUSED") {
          console.error(
            "Frontend server not running, unable to setup user session"
          );
        } else {
          console.error(err);
        }
      }
    );
  } catch (err) {
    console.logColor(
      logging.Red,
      `ERROR::: sendServerDisconnect error: ${err.message}`
    );
  }
}
function sendSpaceInRoomToMatchmaker() {
  if (!config.UseMatchmaker) {
    return;
  }

  try {
    message = {
      type: 'spaceInRoom'
    };
    matchmaker.write(JSON.stringify(message));
  } catch (err) {
    console.logColor(logging.Red, `ERROR sending spaceInRoom: ${err.message}`);
  }
}

function sendSpaceIsFullToMatchmaker() {
  if (!config.UseMatchmaker) {
    return;
  }

  try {
    message = {
      type: 'spaceIsFull'
    };
    matchmaker.write(JSON.stringify(message));
  } catch (err) {
    console.logColor(logging.Red, `ERROR sending spaceIsFull: ${err.message}`);
  }
}

function sendPlayerConnectedToFrontend() {
  //If we are not using the frontend web server don't try and make requests to it
  if (!config.UseFrontend) return;
  try {
    webRequest.get(
      `${FRONTEND_WEBSERVER}/server/clientConnected?gameSessionId=${gameSessionId}&appName=${querystring.escape(
        clientConfig.AppName
      )}`,
      function (response, body) {
        if (response.statusCode === 200) {
          console.log("clientConnected acknowledged by Frontend");
        } else {
          console.error("Status code: " + response.statusCode);
          console.error(body);
        }
      },
      function (err) {
        //Repeatedly try in cases where the connection timed out or never connected
        if (err.code === "ECONNRESET") {
          //timeout
          sendPlayerConnectedToFrontend();
        } else if (err.code === "ECONNREFUSED") {
          console.error(
            "Frontend server not running, unable to setup game session"
          );
        } else {
          console.error(err);
        }
      }
    );
  } catch (err) {
    console.logColor(
      logging.Red,
      `ERROR::: sendPlayerConnectedToFrontend error: ${err.message}`
    );
  }
}

function sendPlayerDisconnectedToFrontend() {
  //If we are not using the frontend web server don't try and make requests to it
  if (!config.UseFrontend) return;
  try {
    webRequest.get(
      `${FRONTEND_WEBSERVER}/server/clientDisconnected?gameSessionId=${gameSessionId}&appName=${querystring.escape(
        clientConfig.AppName
      )}`,
      function (response, body) {
        if (response.statusCode === 200) {
          console.log("clientDisconnected acknowledged by Frontend");
        } else {
          console.error("Status code: " + response.statusCode);
          console.error(body);
        }
      },
      function (err) {
        //Repeatedly try in cases where the connection timed out or never connected
        if (err.code === "ECONNRESET") {
          //timeout
          sendPlayerDisconnectedToFrontend();
        } else if (err.code === "ECONNREFUSED") {
          console.error(
            "Frontend server not running, unable to setup game session"
          );
        } else {
          console.error(err);
        }
      }
    );
  } catch (err) {
    console.logColor(
      logging.Red,
      `ERROR::: sendPlayerDisconnectedToFrontend error: ${err.message}`
    );
  }
}

function sendStreamerConnectedToMatchmaker() {
  if (!config.UseMatchmaker) return;
  try {
    message = {
      type: "streamerConnected",
    };
    matchmaker.write(JSON.stringify(message));
  } catch (err) {
    console.logColor(
      logging.Red,
      `ERROR sending streamerConnected: ${err.message}`
    );
  }
}

function sendStreamerDisconnectedToMatchmaker() {
  if (!config.UseMatchmaker) {
    return;
  }

  try {
    message = {
      type: "streamerDisconnected",
    };
    matchmaker.write(JSON.stringify(message));
  } catch (err) {
    console.logColor(
      logging.Red,
      `ERROR sending streamerDisconnected: ${err.message}`
    );
  }
}

// The Matchmaker will not re-direct clients to this Cirrus server if any client
// is connected.
function sendPlayerConnectedToMatchmaker() {
  if (!config.UseMatchmaker) return;
  try {
    message = {
      type: "clientConnected",
    };
    matchmaker.write(JSON.stringify(message));
  } catch (err) {
    console.logColor(
      logging.Red,
      `ERROR sending clientConnected: ${err.message}`
    );
  }
}

// The Matchmaker is interested when nobody is connected to a Cirrus server
// because then it can re-direct clients to this re-cycled Cirrus server.
function sendPlayerDisconnectedToMatchmaker() {
  if (!config.UseMatchmaker) return;
  try {
    message = {
      type: "clientDisconnected",
    };
    matchmaker.write(JSON.stringify(message));
  } catch (err) {
    console.logColor(
      logging.Red,
      `ERROR sending clientDisconnected: ${err.message}`
    );
  }
}



// Anoiniverse Code

// DTO classes
class AddQueryRequestDTO {
  constructor(pseudonym, executiveId, priority, query) {
    this.pseudonym = pseudonym;
    this.executiveId = executiveId;
    this.priority = priority;
    this.query = query;
  }
}

class ApiResponseDTO {
  constructor(message, data) {
    this.message = message;
    this.data = data;
  }
}


// Verify Signature and domain and roles 
app.get('/verifySig', verifyToken([1, 2]), (req, res) => {
  res.status(200).json({
    sucess: true
  });

});


// Endpoint for adding data to the query table
app.post('/query', verifyToken([1]), (req, res) => {

  // const bearerHeader = req.headers['authorization'];

  // if (typeof bearerHeader !== 'undefined') {

    // employee only
    // const roles = [1];

    // const bearer = bearerHeader.split(' ');

    // const jwt = bearer[1];

    // const bool = validateToken(jwt, roles);


    // console.log('\n\n\n\n');
    // console.log(roles);
    // console.log('emploeeeeeeeeeeee resultttttttttttttttttttttttttttt of access ', bool);
    // console.log('\n\n\n\n');

    // if (bool) {

      const { pseudonym, executiveId, priority, query } = req.body;
      const requestDTO = new AddQueryRequestDTO(pseudonym, executiveId, priority, query);

      const insertQuery = `
            INSERT INTO query (pseudonym, executive_id, priority, query)
            VALUES (?, ?, ?, ?)
          `;

      // db.query(insertQuery, [requestDTO.pseudonym, requestDTO.executiveId, requestDTO.priority, requestDTO.query], (err, result) => {
      db.query(insertQuery, ["\"frozen\"", requestDTO.executiveId, requestDTO.priority, requestDTO.query], (err, result) => {

        if (err) {
          console.error('Error inserting data into query table: ' + err.message);
          res.status(500).json(new ApiResponseDTO('Internal server error'));
        } else {
          console.log('Data inserted successfully');
          res.status(200).json(new ApiResponseDTO('Data inserted successfully'));
        }
      });
    // }
  // }
});

//   }
//     else {
//   res.status(401).json({
//     success: false,
//     Access: 'Access Denied'

//   })
// }
//   }
//   else {
//   res.status(403).json({
//     success: false,
//     Access: 'Access Denied'
//   })
// }

// });

app.get('/queries/:executiveId', verifyToken([2]), (req, res) => {

  // const bearerHeader = req.headers['authorization'];

  // if (typeof bearerHeader !== 'undefined') {

    // // executive only
    // const roles = [2];

    // const bearer = bearerHeader.split(' ');

    // const jwt = bearer[1];

    // const bool = validateToken(jwt, roles);

    // console.log('\n\n\n\n');
    // console.log('resultttttttttttttttttttttttttttt of access', bool);
    // console.log('\n\n\n\n');

    // if (bool) {

      const executiveId = req.params.executiveId;

      // Query to fetch data by executiveId and organize it by priority, selecting only active users
      const fetchQuery = `
        SELECT q.priority, u.pseudonym, q.query AS message
        FROM query q
        JOIN user u ON q.pseudonym = u.pseudonym
        WHERE q.executive_id = ? AND u.is_active = 1
        ORDER BY created_at DESC
      `;

      // once we take pseudonmy uncomment bellow (todo)
      // const fetchQuery = `
      // const fetchQuery = `
      // SELECT q.priority, u.pseudonym, q.query AS message
      // FROM query q
      // JOIN user u ON q.user_id = u.id
      // WHERE q.executive_id = ? AND u.is_active = 1
      // ORDER BY created_at DESC
      // `;
      // `;

      db.query(fetchQuery, [executiveId], (err, rows) => {
        if (err) {
          console.error('Error fetching data from query table: ' + err.message);
          res.status(500).json(new ApiResponseDTO('Internal server error', null));
        } else {
          console.log('Data fetched successfully');

          // Organize data by priority
          // const organizedData = {
          //     low: [],
          //     medium: [],
          //     high: [],
          //     urgent: [],
          // };

          // for (const row of rows) {
          //     const { priority, pseudonym, message } = row;
          //     if (!organizedData[priority]) {
          //         organizedData[priority] = [];
          //     }
          //     organizedData[priority].push({ pseudonym, message });
          // }

          res.status(200).json(rows);
        }
      });
    // }
    // else {
    //   res.status(401).json({
    //     success: false,
    //     Access: 'Access Denied'
    //   })
    // }
  // }
  // else {
  //   res.status(403).json({
  //     success: false,
  //     Access: 'Access Denied'
  //   })
  // }

});

// Define DTO classes
class ExecutiveDTO {
  constructor(name, avatar_url) {
    this.name = name;
    this.avatar_url = avatar_url;
  }
}

class UserDTO {
  constructor(name, avatar_url) {
    this.name = name;
    this.avatar_url = avatar_url;
  }
}

// Define a route to create a new executive
app.post('/executive', (req, res) => {
  try {
    const department_id = 1;
    const { name, avatar_url } = req.body;

    // Validate the incoming data using the ExecutiveDTO
    const executiveData = new ExecutiveDTO(name, avatar_url);

    // Insert a new executive into the database
    const query = 'INSERT INTO executive (name, department_id, avatar_url) VALUES (?, ?, ?)';
    const values = [executiveData.name, department_id, executiveData.avatar_url];

    db.query(query, values, (err, result) => {
      if (err) {
        console.error('Error inserting executive:', err);
        return res.status(400).json({ error: 'Unable to create executive' });
      }

      console.log('New executive created with ID:', result.insertId);
      return res.status(201).json({ message: 'Executive created successfully' });
    });
  } catch (error) {
    console.error('Error:', error);
    return res.status(400).json({ error: 'Invalid request data' });
  }
});

// Define a route to create a new user
app.post('/users', (req, res) => {
  try {
    const { name, avatar_url } = req.body;

    // Validate the incoming data using the UserDTO
    const userData = new UserDTO(name, avatar_url);

    // Insert a new user into the database
    const query = 'INSERT INTO user (pseudonym, avatar_url, is_active) VALUES (?, ?, 1)';
    const values = [userData.name, userData.avatar_url];

    db.query(query, values, (err, result) => {
      if (err) {
        console.error('Error inserting user:', err);
        return res.status(400).json({ error: 'Unable to create user' });
      }

      console.log('New user created with ID:', result.insertId);
      return res.status(201).json({ message: 'User created successfully' });
    });
  } catch (error) {
    console.error('Error:', error);
    return res.status(400).json({ error: 'Invalid request data' });
  }
});
