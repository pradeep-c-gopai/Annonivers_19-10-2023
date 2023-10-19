const axios = require('axios');

// Step 1: Discover the Public Key Endpoint
const discoveryUrl = 'https://accounts.google.com/.well-known/openid-configuration';

module.exports.getGooglePubKeys = async function () {

    try {

        const response = await axios.get(discoveryUrl);

        const metadataObj = response.data;

        // Step 2: Retrieve Google's Public Keys
        const jwksUri = metadataObj.jwks_uri;

        const keysData = await axios.get(jwksUri);

        console.log(keysData);

        const keysObj = keysData.data;

        console.log(keysObj);

        return keysObj;

    }
    catch (error) {

    }

}
