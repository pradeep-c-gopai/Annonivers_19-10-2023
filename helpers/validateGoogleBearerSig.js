const { getGooglePubKeys } = require('./getGooglePublicKeys');

var jwt = require('jsonwebtoken');

const jwt_decode = require('jwt-decode');

var jwkToPem = require('jwk-to-pem');

module.exports.validateGoogleSig = async function (bearerToken_) {

  try {

    const jwks = await getGooglePubKeys();

    console.log('JWKS\n\n');

    console.log(jwks);

    console.log('\n\nJWKS');

    try {

      const decoded = jwt.decode(bearerToken_, { complete: true });

      console.log('decoded: \n\n');

      console.log(decoded);

      console.log('\n\ndecoded');

      const key1 = decoded.header.kid;
      
      console.log('key: \n\n\n');
      
      console.log(key1);

      console.log('\n\n\n key');

      const foundKey = jwks.keys.find(key => key.kid === key1);

      console.log('found key: \n\n');

      console.log(foundKey);

      console.log('\n\nfound key: \n\n');

      var pem = jwkToPem(foundKey);

      const sigVerifiactionKey_1 = await jwt.verify(bearerToken_, pem, { algorithms: ['RS256'] });

      console.log(sigVerifiactionKey_1);

      console.log(true);

      return true;

    }
    catch (err) {

      console.log(err)

      console.log('err verifying signature with first key');

      return false;


    }

  }
  catch (err) {

    console.log(`can't fetch google public keys`);

    throw err;

  }

}
